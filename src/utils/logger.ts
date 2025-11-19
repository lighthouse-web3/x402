import { createLogger, format, transports, Logger } from 'winston'
import config from '../config/index.js'

const selectTransports = (): transports.FileTransportInstance => {
  return new transports.File({
    filename: config.devLogPath,
  })
}

const logger: Logger = createLogger({
  level: 'info',
  defaultMeta: {
    service: 'x402-api',
  },
  exitOnError: false,
  format: format.combine(format.json(), format.timestamp(), format.metadata(), format.prettyPrint(), format.errors()),
  transports: selectTransports(),
})

export default logger

