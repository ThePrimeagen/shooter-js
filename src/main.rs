use std::sync::{Arc, atomic::AtomicUsize, Mutex};

use futures_util::{stream::StreamExt, SinkExt};
use anyhow::Result;
use clap::Parser;
use serde::{Serialize, Deserialize};
use tokio::task::JoinHandle;
use url::Url;

// the tag is the type value
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum Message {
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "stop")]
    Stop { ticks: u32, bullets_fired: u32, won: bool, error_msg: Option<String> },
    #[serde(rename = "fire")]
    Fire,
    #[serde(rename = "error")]
    Error { msg: String },
}

#[derive(Debug, Parser)]
struct Config {

    #[clap(short, long, default_value_t = 42069)]
    port: usize,

    #[clap(long, default_value = "0.0.0.0")]
    host: String,

    #[clap(short, long, default_value_t = 10000)]
    games: usize,

    #[clap(short = 'q', long, default_value_t = 100)]
    parallel: usize,
}

async fn create_client(url: &'static str, fire_wait: u64) -> Result<Option<Message>> {
    let (stream, _) = tokio_tungstenite::connect_async(url).await?;

    let (mut write, mut read) = stream.split();

    let msg = read.next().await;
    if let Some(Ok(msg)) = msg {
        let msg: Message = serde_json::from_slice(&msg.into_data())?;
        match msg {
            Message::Fire | Message::Stop { .. } => {
                return Err(anyhow::anyhow!("message received isn't start message"));
            },
            _ => {},
        }
    } else {
        return Err(anyhow::anyhow!("failed to read start message"));
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel(2);

    tokio::spawn(async move {
        loop {
            let msg = read.next().await;
            if let Some(Ok(msg)) = msg {
                let msg: Result<Message, _> = serde_json::from_slice(&msg.into_data());
                let msg = match msg {
                    Ok(msg) => msg,
                    Err(e) => {
                        tx.send(Message::Error { msg: format!("failed at parsing: {:?}", e) }).await;
                        break;
                    }
                };

                tx.send(msg).await;
            }
        }
    });

    let mut last_time = std::time::Instant::now();
    let mut stop: Option<Message> = None;
    loop {
        tokio::select! {
            msg = rx.recv() => {
                let msg = match msg {
                    Some(msg) => msg,
                    None => break,
                };

                match msg {
                    Message::Stop { .. } => {
                        stop = Some(msg);
                        break;
                    },
                    Message::Error { msg } => {
                        return Err(anyhow::anyhow!(msg));
                    },
                    _ => {},
                }
            },

            _ = tokio::time::sleep(
                tokio::time::Duration::from_millis(
                    (fire_wait as u64).saturating_sub(last_time.elapsed().as_millis() as u64))) => {

                last_time = std::time::Instant::now();
                write.send(tokio_tungstenite::tungstenite::Message::Text(
                    serde_json::to_string(&Message::Fire)?)).await?;
            }
        }
    }

    return Ok(stop);
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct GameResult {
    ticks: usize,
    bullets_fired: usize,
    p1_won: usize,
    p2_won: usize,
}

impl GameResult {
    fn add(&mut self, msg: Message, player: usize) {
        if let Message::Stop { ticks, bullets_fired, won, error_msg } = msg {
            self.ticks += ticks as usize;
            self.bullets_fired += bullets_fired as usize;
            if won && player == 1 {
                self.p1_won += 1;
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::parse();
    let url = format!("ws://{}:{}", config.host, config.port);
    let url: &'static Url = Box::leak(Box::new(Url::parse(&url)?));
    let semaphore = Arc::new(tokio::sync::Semaphore::new(config.parallel));
    let fails = Arc::new(AtomicUsize::new(0));
    let game_results = Arc::new(Mutex::new(GameResult::default()));
    let mut handles = Vec::new();

    for i in 0..config.games {
        let permit = semaphore.clone().acquire_owned().await?;
        let fails = fails.clone();
        let game_results = game_results.clone();

        let handle = tokio::spawn(async move {
            // client 1 should always win
            let results = futures_util::join!(
                create_client(url.as_str(), 110),
                create_client(url.as_str(), 170)
            );

            match results {
                (Ok(Some(s1)), Ok(Some(s2))) => {
                    if let Ok(mut game_results) = game_results.lock() {
                        game_results.add(s1, 1);
                        game_results.add(s2, 2);
                    }
                }
                (Ok(_), Err(_)) => {
                    fails.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
                (Err(_), Ok(_)) => {
                    fails.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
                (Err(_), Err(_)) => {
                    fails.fetch_add(2, std::sync::atomic::Ordering::Relaxed);
                }
                _ => unreachable!(),
            }

            drop(permit);
        });

        if handles.len() < config.parallel {
            handles.push(handle);
        } else {
            handles[i % config.parallel] = handle;
        }
    }

    futures_util::future::join_all(handles).await;

    println!("{:?}", game_results.lock().unwrap());

    return Ok(());
}
