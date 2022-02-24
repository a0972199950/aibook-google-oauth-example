import express from 'express'
import https from 'https'
import fs from 'fs'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  '206089709877-k24cfh4egvbn8v8t2qh7l6ob1c88u5tn.apps.googleusercontent.com',
  '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',
  'https://localhost:3000/auth/google/callback'
)

const app = express()

app.use(cors({
  origin: 'https://localhost:3000'
}))

app.use(cookieParser())

app.get('/', (req, res) => {
  res.send('ok')
})

// 初次授權流程，用 code 交換 google 相簿的 access_token 端點
app.get('/tokens', async (req, res) => {
  const code = req.query.code as string

  try {
    const { tokens: { access_token, refresh_token } } = await oauth2Client.getToken(code)

    // TODO: 把 access token, refresh token, 以及其對應的 cognito user id 存到 database

    // 回傳 access token 給前端並同時將 access token 寫入 cookie
    res
      .header({
        'Access-Control-Allow-Credentials': true
      })
      .cookie('AIBOOK_GOOGLE_OAUTH_ACCESS_TOKEN', access_token, {
        maxAge: 1000 * 60 * 60 * 24 * 7 // 一週
      })
      .status(200)
      .json({
        accessToken: access_token
      })
  } catch (e) {
    console.log(e)

    res.status(401).json({
      message: '交換 access token 失敗',
      error: e
    })
  }
})

/**
 * 當前端使用 cookie 中存有的 access token 呼叫 google API 卻失敗時，代表該 access token 已過期或是被竄改
 * 這時前端會在背景呼叫這支 API 做 refresh。過程中使用者不會再次需要重新進行一次授權流程，只會看到 loading 畫面
 */
app.get('/cookie/google/refresh', async (req, res) => {
  try {
    // TODO: 從 database 找出先前存起來的 refresh token
    const refreshToken = 'refreshToken'

    if (!refreshToken) {
      throw 'No refresh token stored'
    }

    /**
     *  TODO: 使用 refresh token 交換新的 access token
     * Spec: https://developers.google.com/identity/protocols/oauth2/web-server#offline
     */
    const access_token = 'new access token'

    // TODO: 把 access token, refresh token, 以及其對應的 cognito user id 存到 database

    // 回傳 access token 給前端並同時將 access token 寫入 cookie
    res
      .header({
        'Access-Control-Allow-Credentials': true
      })
      .cookie('AIBOOK_GOOGLE_OAUTH_ACCESS_TOKEN', access_token, {
        maxAge: 1000 * 60 * 60 * 24 * 7 // 一週
      })
      .status(200)
      .json({
        accessToken: access_token
      })
  } catch (e) {

    /**
     * 當:
     * 1. database 中不存在 refresh token
     * 2. refresh token 已過期
     * 時，請回復前端 401。前端收到 401 的回覆，就會引導使用者再進行一次 google 授權流程
     */
    res.status(401).json({ message: 'Please re-authenticate from google'})
  }
})

// 所有和 google 相簿相關聯的端點。這邊只舉一個 put 當例子
app.put('/project/{projectId}/google-album', (req, res) => {
  // Google access token 從原本的 req.query，改成由 req.cookies 取得
  const googleAuthAccessToken = req.cookies.AIBOOK_GOOGLE_OAUTH_ACCESS_TOKEN

  // TODO: 使用 access token 獲取相簿、相片...etc
})

// 這支端點會清除 database 存有的 access token, refresh token。可以用作切換 google 相簿帳戶使用
app.put('/tokens/clear', () => {
  // TODO: 清除 database 中的 access token, refresh token
})

const httpsServer = https.createServer({
  key: fs.readFileSync('./certs/server.key'),
  cert: fs.readFileSync('./certs/server.crt')
}, app)

httpsServer.listen(8000, () => {
  console.log('Server started')
})
