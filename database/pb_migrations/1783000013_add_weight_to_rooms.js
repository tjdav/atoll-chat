/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const rooms = app.findCollectionByNameOrId('rooms')
  if (rooms && !rooms.fields.getByName('weight')) {
    rooms.fields.add(new NumberField({
      name: 'weight',
      required: false,
      noDecimal: true,
      min: 0,
      help: 'Sorting weight for rooms (higher weight appears first, default 0)'
    }))
    app.save(rooms)

    try {
      const records = app.findRecordsByFilter('rooms', 'weight = null || weight = 0', '', 0, 0)
      for (const rec of records) {
        if (rec.get('weight') === null || rec.get('weight') === undefined) {
          rec.set('weight', 0)
          app.save(rec)
        }
      }
    } catch (_err) {
      // Ignore filter error if empty
    }
  }
}, (app) => {
  const rooms = app.findCollectionByNameOrId('rooms')
  if (rooms) {
    rooms.fields.removeByName('weight')
    app.save(rooms)
  }
})
