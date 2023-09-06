package pages

import (
	"bytes"
	"encoding/json"
	"os"
	"sort"
	"strconv"

	"github.com/labstack/echo/v4"
)

type Chart struct {
    Id int
    Title string
    Data []int
    Labels []string
}

func newChart(id int, title string) *Chart {
    return &Chart {
        Id: id,
        Title: title,
        Data: make([]int, 0),
        Labels: make([]string, 0),
    }
}

func idxOf(labels []string, label string) int {
    for i, l := range labels {
        if l == label {
            return i
        }
    }

    return -1
}


func (c *Chart) addPoint(title string, value int, idx int) {
    for len(c.Data) <= idx {
        c.Data = append(c.Data, 0)
        c.Labels = append(c.Labels, "")
    }

    c.Data[idx] = c.Data[idx] + value
    c.Labels[idx] = title
}

func (c *Chart) addLine(line map[string]interface{}) {
    if title, ok := line["title"].(string); ok {
        if title != c.Title {
            return
        }
    } else {
        return
    }


    // iterate over property pointSet that is a map[string]int
    pointSet, ok := line["pointSet"].(map[string]interface{})
    if ok {
        for key, v := range pointSet {
            v64, ok := v.(float64)
            if !ok {
                continue
            }

            value := int(v64)
            idx := idxOf(c.Labels, key)

            if idx == -1 {
                c.Data = append(c.Data, value)
                c.Labels = append(c.Labels, key)
            } else {
                c.Data[idx] = c.Data[idx] + value
            }

        }
    }
}

func (c *Chart) sortLabels() {
    data := make([]int, len(c.Data))
    labels := make([]string, len(c.Labels))

    copy(labels, c.Labels)
    sort.Slice(labels, func(i, j int) bool {
        numA, _ := strconv.Atoi(labels[i])
        numB, _ := strconv.Atoi(labels[j])
        return numA < numB
    })

    for i := 0; i < len(labels); i++ {
        idx := idxOf(c.Labels, labels[i])
        if idx == -1 {
            panic("idx is -1")
        }

        data[i] = c.Data[idx]
    }

    c.Data = data
    c.Labels = labels
}

func (c *Chart) getTickTotal() int {
    total := 0
    for _, v := range c.Data {
        total += v
    }

    return total
}

type Page struct {
    Charts []*Chart
    ErrorMsg string
    File string
    TotalTicks int
}

func Index(c echo.Context) error {
    file := c.QueryParam("file");

    c.Logger().Error("file: ", file)

    if file == "" {
        return c.Render(200, "index.html", nil)
    }

    // read file and parse line by line
    lines, err := os.ReadFile(file)
    c.Logger().Error("file error: ", err)
    if err != nil {
        c.Logger().Error("error: ", err.Error())
        return c.Render(200, "index.html", Page {
            Charts: nil,
            ErrorMsg: err.Error(),
            File: file,
        })
    }

    chartData := make(map[string]*Chart)
    chartTickClassify := newChart(0, "Tick Classification")
    titleIdx := map[string]int{
        "tickOnTime": 0,
        "tickIntervalOverrun": 1,
        "tickIntervalUnderrun": 2,
    }
    id := 1

    // for each over each line
    // its a byte array, therefore we need to split on new line

    for _, line := range bytes.Split(lines, []byte("\n")) {
        var parsed map[string]interface{}
        err := json.Unmarshal(line, &parsed)
        if err != nil {
            c.Logger().Error("couldn't json line", err)
            continue
        }

        title, ok := parsed["title"].(string)

        if !ok {
            c.Logger().Error("line doesn't contain title and pointSet", parsed)
            continue
        }

        if title == "tickOnTime" || title == "tickIntervalOverrun" || title == "tickIntervalUnderrun" {
            chartTickClassify.addPoint(title, int(parsed["count"].(float64)), titleIdx[title])
            continue
        }

        chart, ok := chartData[title]
        if !ok {
            chart = newChart(id, title)
            chartData[title] = chart
        }

        id += 1
        chart.addLine(parsed)
    }

    charts := make([]*Chart, 0)
    charts = append(charts, chartTickClassify)

    totalTicks := 0
    for _, chart := range chartData {
        chart.sortLabels()
        totalTicks += chart.getTickTotal()
        charts = append(charts, chart)
    }
    c.Logger().Error("charts", len(charts))

    return c.Render(200, "index.html", Page {
        ErrorMsg: "",
        Charts: charts,
        File: file,
        TotalTicks: totalTicks,
    })
}

