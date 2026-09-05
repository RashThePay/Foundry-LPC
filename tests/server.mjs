import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
const root = process.cwd()
http
  .createServer(async (req, res) => {
    try {
      const file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`)
      if (!file.startsWith(root + path.sep)) throw new Error('Outside root')
      const body = await readFile(file)
      res.setHeader(
        'Content-Type',
        file.endsWith('.mjs')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.json')
              ? 'application/json'
              : 'text/html'
      )
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  })
  .listen(4179, '127.0.0.1')
