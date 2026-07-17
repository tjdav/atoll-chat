// database/pb_hooks/push_notifications.pb.js

onRecordAfterCreateRequest((e) => {
  const message = e.record
  const roomId = message.get('room_id')
  const senderId = message.get('sender_id')

  // Find room members
  let members = []
  try {
    members = $app.findRecordsByFilter(
      'room_members',
      'room_id = {:roomId}',
      '-created',
      500,
      0,
      { roomId: roomId }
    )
  } catch (err) {
    console.error('[push_notifications] Error fetching room members:', err)
    return
  }

  const subscriptions = []

  for (let i = 0; i < members.length; i++) {
    const member = members[i]
    const userId = member.get('user_id')

    // Filter out sender
    if (userId === senderId) {
      continue
    }

    // Filter out kicked members
    const role = member.get('role')
    if (role === 'kicked') {
      continue
    }

    // Filter out muted members
    const isMuted = member.get('is_muted')
    if (isMuted === true) {
      continue
    }

    // Fetch user details to extract push_subscription
    try {
      const user = $app.findRecordById('users', userId)
      const pushSub = user.get('push_subscription')
      if (pushSub) {
        let parsed = pushSub
        if (typeof pushSub === 'string') {
          try {
            parsed = JSON.parse(pushSub)
          } catch {
            /* If string is invalid JSON, ignore */
          }
        }
        if (parsed && (parsed.endpoint || parsed.keys)) {
          subscriptions.push(parsed)
        }
      }
    } catch (err) {
      console.warn('[push_notifications] Error fetching user push subscription:', err)
    }
  }

  if (subscriptions.length === 0) {
    return
  }

  const pushWorkerUrl = $os.getenv('PUSH_WORKER_URL')
  if (!pushWorkerUrl) {
    console.warn('[push_notifications] Missing PUSH_WORKER_URL environment variable; skipping push dispatch.')
    return
  }

  const payload = {
    subscriptions: subscriptions,
    payload: {
      type: 'NEW_MESSAGE',
      room_id: roomId,
      message_id: message.id
    }
  }

  try {
    const res = $http.send({
      url: pushWorkerUrl + '/send-push',
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10
    })

    if (res.statusCode >= 400) {
      console.error('[push_notifications] Push worker error response. Status:', res.statusCode, 'Body:', res.text)
    } else {
      console.log('[push_notifications] Successfully dispatched payload to push-worker.')
    }
  } catch (err) {
    console.error('[push_notifications] Failed to request push-worker:', err)
  }
}, 'messages')
