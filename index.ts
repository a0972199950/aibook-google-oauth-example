import express from 'express'
import https from 'https'
import fs from 'fs'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import swaggerJsdoc from 'swagger-jsdoc'
import { google } from 'googleapis'

const app = express()

app.use(cors({
  origin: 'https://localhost:3000'
}))

app.use(cookieParser())

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '',
      version: '1.0.0'
    }
  },
  apis: ['*.ts']
}

const openapiSpecification = swaggerJsdoc(swaggerOptions)

fs.writeFileSync('./swagger.json', JSON.stringify(openapiSpecification))

const refreshGoogleAccessToken = (refreshToken: string) => {
  /**
   *  TODO: 使用 refresh token 交換新的 access token
   * Spec: https://developers.google.com/identity/protocols/oauth2/web-server#offline
   */
  const newAccessToken = 'new access token'

  return newAccessToken
}

app.get('/', (req, res) => {
  res.send('ok')
})

/**
 * @openapi
 * /auth/google/url:
 *   get:
 *     description: 前端獲取 google auth 授權網址的端點。client id 和 scope 統一由後端決定，避免兩者不一致的問題
 *     parameters:
 *       - in: query
 *         name: state
 *         required: false
 *         description: 自由參數
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: google auth 網址
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 */
app.get('/auth/google/url', (req, res) => {
  const state = req.query.state

  const googleOauth2Client = new google.auth.OAuth2(
    '206089709877-k24cfh4egvbn8v8t2qh7l6ob1c88u5tn.apps.googleusercontent.com',
    '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',
    `${req.get('Origin')}/auth/google/callback`
  )

  const url = googleOauth2Client.generateAuthUrl({
    scope: 'https://www.googleapis.com/auth/photoslibrary https://www.googleapis.com/auth/photoslibrary.readonly https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
    access_type: 'offline',
    include_granted_scopes: true,
    response_type: 'code',
    state: (state && typeof state === 'string') ? state : '',
    redirect_uri: `${req.get('Origin')}/auth/google/callback`,
    client_id: '206089709877-k24cfh4egvbn8v8t2qh7l6ob1c88u5tn.apps.googleusercontent.com',
    prompt: 'consent'
  })

  res.status(200).json({ url })
})

/**
 * @openapi
 * /auth/google/callback:
 *   get:
 *     description: 初次授權流程，用 code 交換 google 相簿的 access_token 端點
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         description: Google oauth2 one time code
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: google access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 */
app.get('/auth/google/callback', async (req, res) => {
  const userId = 'userId'
  const code = req.query.code as string

  const oauth2Client = new google.auth.OAuth2(
    '206089709877-k24cfh4egvbn8v8t2qh7l6ob1c88u5tn.apps.googleusercontent.com',
    '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',
    `${req.get('Origin')}/auth/google/callback`
  )

  try {
    const { tokens: { access_token: accessToken, refresh_token: refreshToken } } = await oauth2Client.getToken(code)

    // TODO: 把 access token, refresh token, 以及其對應的 cognito user id 存到 database

    // 回傳 access token 給前端並同時將 access token 寫入 cookie
    res
      .header({
        'Access-Control-Allow-Credentials': true
      })
      .cookie(
        'AIBOOK_GOOGLE_OAUTH_ACCESS_TOKEN',
        Buffer
          .from(JSON.stringify({ accessToken, userId }))
          .toString('base64'),
        {
          maxAge: 1000 * 60 * 60 * 24 * 7 // 一週
        }
      )
      .status(200)
      .json({ accessToken })

  } catch (e) {
    console.log(e)

    res.status(401).json({
      message: '交換 access token 失敗',
      error: e
    })
  }
})

/**
 * @openapi
 * /auth/google/access-token:
 *   get:
 *     description: 當前端使用 cookie 中存有的 access token 呼叫 google API 卻失敗時，代表該 access token 已過期或是被竄改。這時前端會在背景呼叫這支 API 做 refresh。過程中使用者不會再次需要重新進行一次授權流程，只會看到 loading 畫面
 *     responses:
 *       200:
 *         description: google access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 */
app.get('/auth/google/access-token', async (req, res) => {
  try {
    const userId = 'userId'

    // TODO: 從 database 找出先前存起來的 refresh token
    const refreshToken = 'refreshToken'

    if (!refreshToken) {
      throw 'No refresh token stored'
    }

    const newAccessToken = refreshGoogleAccessToken(refreshToken)

    // TODO: 把新的 access token, 以及其對應的 cognito user id 存到 database

    // 回傳 access token 給前端並同時將 access token 寫入 cookie
    res
      .header({
        'Access-Control-Allow-Credentials': true
      })
      .cookie(
        'AIBOOK_GOOGLE_OAUTH_ACCESS_TOKEN',
        Buffer
          .from(JSON.stringify({
            accessToken: newAccessToken,
            userId
          }))
          .toString('base64'),
        {
          maxAge: 1000 * 60 * 60 * 24 * 7 // 一週
        }
      )
      .status(200)
      .json({ accessToken: newAccessToken })

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
  const userId = 'userId'

  new Promise((resolve, reject) => {
    // Google access token 從原本的 req.query，改成由 database 取得
    const googleAuthAccessToken = 'accessToken'

    // TODO: 使用 access token 獲取相簿、相片...etc

    res
      .status(200)
      .json({ /** response 內容 */ })
  })
  .catch(() => {
    /**
     * access token 過期，導致無法使用相簿 API
     */
  
    const refreshToken = 'refreshToken'

    const newAccessToken = refreshGoogleAccessToken(refreshToken)

    // TODO: 把 new access token 存起來

    // TODO: 使用 new access token 獲取相簿、相片...etc

    res
      .status(200)
      .cookie(
        'AIBOOK_GOOGLE_OAUTH_ACCESS_TOKEN',
        Buffer
          .from(JSON.stringify({
            accessToken: newAccessToken,
            userId
          }))
          .toString('base64'),
        {
          maxAge: 1000 * 60 * 60 * 24 * 7 // 一週
        }
      )
      .status(200)
      .json({ /** response 內容 */ })
  })
  .catch(() => {
    /**
     * 不但 access token 過期，還無法使用 refresh token 交換新的 access token
     */

    res.status(401).json({ message: 'Please re-authenticate from google'})
  })

  
})

const httpsServer = https.createServer({
  key: fs.readFileSync('./certs/server.key'),
  cert: fs.readFileSync('./certs/server.crt')
}, app)

httpsServer.listen(8000, () => {
  console.log('Server started')
})
