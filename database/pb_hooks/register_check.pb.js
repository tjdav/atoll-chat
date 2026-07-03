// pb_hooks/register_check.pb.js

routerAdd('GET', '/api/check-availability', (e) => {
  const username = e.request.url.query().get('username')
  const email = e.request.url.query().get('email')

  let usernameExists = false
  let emailExists = false

  if (username) {
    const result = new DynamicModel({ id: '' })
    try {
      $app.db()
        .select('id')
        .from('users')
        .where($dbx.hashExp({ username: username }))
        .limit(1)
        .one(result)
      usernameExists = true
    } catch (err) {
      // Check if it's a real error or just "not found"
      if (err.message && !err.message.includes('no rows in result set')) {
        $app.logger().error('Availability check error (username)', 'error', err.message, 'username', username)
      }
    }
  }

  if (email) {
    const result = new DynamicModel({ id: '' })
    try {
      $app.db()
        .select('id')
        .from('users')
        .where($dbx.hashExp({ email: email }))
        .limit(1)
        .one(result)
      emailExists = true
    } catch (err) {
      // Check if it's a real error or just "not found"
      if (err.message && !err.message.includes('no rows in result set')) {
        $app.logger().error('Availability check error (email)', 'error', err.message, 'email', email)
      }
    }
  }

  return e.json(200, {
    usernameExists,
    emailExists
  })
})
