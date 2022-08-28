// \! chcp 1251
const express = require('express')
const needle = require('needle')
const cors = require('cors')
const Pool = require('pg').Pool
const axios = require('axios')
const app = express()
app.use(cors())

// document.location.href = `${error.response.data.errors[0].captcha_url}&backurl='http://127.0.0.1:5500/index.html'`

const pool = new Pool({
  user: 'postgres',
  host: '127.0.0.1',
  database: 'vacna',
  password: 'zxczxc2013',
  port: 5432,
})

app.get('/getDates', (req, res) => {
  pool.query('SELECT * FROM date_of_completion', (e, results) =>
    res.send(results.rows)
  )
})

app.get('/getTools', async (req, res) => {
  pool.query('SELECT * FROM categories', (e, result) => {
    if (e) return console.log(err)

    const categories = result.rows
    pool.query('SELECT * FROM tools', (e, result) => {
      let tools = result.rows
      tools = tools.map(tool => {
        const category = categories.find(
          category => category.id_category === tool.id_category
        )
        delete tool.id_category
        return { ...tool, category }
      })
      pool.query('SELECT * FROM date_of_completion', (e, results) => {
        const dates = results.rows
        pool.query(
          'SELECT * FROM count_in_indeed;SELECT * FROM count_in_headhunter',
          async (error, results) => {
            const counts = [...results[0].rows, ...results[1].rows]

            tools = tools.map(tool => ({ ...tool, counts: {} }))
            dates.map(date => {
              return (tools = tools.map(tool => {
                const count = counts.filter(
                  count =>
                    count.id_tool === tool.id_tool &&
                    date.id_date === count.date_of_completion
                )
                const [countIndeed, countHeadHunter] = [
                  count[0]._count,
                  count[1]._count,
                ]
                tool.counts[date.id_date] = { countHeadHunter, countIndeed }
                return { ...tool }
              }))
            })

            res.status(200).json(tools)
          }
        )
      })
    })
  })
})

app.get('/getCategories', (req, res) => {
  pool.query('SELECT * FROM categories', (error, results) => {
    res.status(200).json(results.rows)
  })
})

app.get('/getCount', (req, res) => {
  pool.query(
    'SELECT * FROM count_in_indeed;SELECT * FROM count_in_headhunter',
    (error, results) => res.status(200).json(results)
  )
})

async function uploadDataToTheDatabase() {
  const start = new Date()

  const now = new Date()
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth()).padStart(2, '0')
  const year = String(now.getFullYear()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const date = `${day}.${month}.${year} ${hours}:${minutes}`

  await pool.query(
    `INSERT INTO date_of_completion(date_of_completion) VALUES('${date}')`
  )

  pool.query('SELECT * FROM tools', async (e, result) => {
    let tools = result.rows

    for (let i = 0; i < tools.length; i++) {
      const result = await axios({
        method: 'get',
        url: `https://api.hh.ru/vacancies?text=${encodeURIComponent(
          tools[i].name_tool
        )}&area=1&no_magic=true&page=0&per_page=0`,
      })
      pool.query(
        `INSERT INTO count_in_headhunter(
        id_tool,
        date_of_completion,
        _count)
        VALUES(
        ${tools[i].id_tool},
        (SELECT id_date FROM date_of_completion ORDER BY id_date DESC LIMIT 1),
        ${result.data.found})`
      )
    }

    let countOfError = 0

    async function getCount(tool) {
      if (countOfError > 10)
        return pool.query(
          `INSERT INTO count_in_indeed(
        id_tool,
        date_of_completion,
        _count)
        VALUES(
        ${tool.id_tool},
        (SELECT id_date FROM date_of_completion ORDER BY id_date DESC LIMIT 1),
        0)`
        )
      try {
        const encodeString = encodeURIComponent(tool.name_tool)
        const url =
          encodeString === tool.name_tool
            ? `https://www.indeed.com/q-${tool.name_tool}-jobs.html`
            : `https://www.indeed.com/jobs?q=${encodeString}&vj&vjk`

        let resp = await needle('get', url)

        let indexFirstDigit = resp.body.indexOf('Page 1 of ') + 10
        if (indexFirstDigit === 9) {
          countOfError++
          return getCount(tool)
        }
        let number = resp.body.slice(indexFirstDigit, indexFirstDigit + 10)
        let result = ''
        for (const char of number) {
          if (char === ' ') {
            return pool.query(
              `INSERT INTO count_in_indeed(
            id_tool,
            date_of_completion,
            _count)
            VALUES(
            ${tool.id_tool},
            (SELECT id_date FROM date_of_completion ORDER BY id_date DESC LIMIT 1),
            ${result})`
            )
          }
          if (char === ',') continue
          result += char
        }
      } catch (error) {
        console.log('Произошла ошибка')
        console.log(error)
        return getCount(tool)
      }
    }

    for (let i = 0; i < tools.length; i++) {
      countOfError = 0
      await getCount(tools[i])
    }
    console.log(`Потрачено минут: ${((new Date() - start) / 60000).toFixed(2)}`)
  })
}

app.get('/uploadDataToTheDatabase', (req, res) => uploadDataToTheDatabase())

const port = 5501
app.listen(port, () => {
  console.log('SERVER WORKING!', port)
})
