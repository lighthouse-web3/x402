import express, { Request, Response, Application } from 'express'
import cors from 'cors'
import morgan from 'morgan'
import bodyParser from 'body-parser'
import expressWinston from 'express-winston'

import logger from './utils/logger.js'
import errorHandler from './middlewares/error/index.js'

import X402Router from './routes/x402.js'

const app: Application = express()
app.use(bodyParser.urlencoded({ extended: false }))

app.use(bodyParser.json())

app.use(
  expressWinston.errorLogger({
    winstonInstance: logger,
  }),
)

app.use(morgan('dev'))
app.use(cors())

app.get('/health', (req: Request, res: Response): void => {
  res.status(200).send('OK')
})

app.use('/api/x402', X402Router)

app.use(errorHandler)

export default app

