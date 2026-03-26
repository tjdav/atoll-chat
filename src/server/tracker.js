import { Server } from 'bittorrent-tracker'

const port = process.env.TRACKER_PORT || 8000

const server = new Server({
  udp: false,
  http: false,
  ws: true,
  stats: true
})

server.on('error', function (err) {
  console.log(err.message)
})

server.on('warning', function (err) {
  console.log(err.message)
})

server.on('listening', function () {
  console.log('WebRTC Private Tracker listening on ws port ' + port)
})

server.listen(port, '0.0.0.0')
