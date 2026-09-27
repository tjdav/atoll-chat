INSERT OR IGNORE INTO roles (id, name, level, permissions) VALUES
    ('role_owner',   'owner',   100, '["*"]'),
    ('role_admin',   'admin',    80, '["user.manage","invite.unlimited","config.edit","room.force_delete","backup.manage"]'),
    ('role_inviter', 'inviter',  50, '["invite.limited"]'),
    ('role_member',  'member',   10, '["room.create","room.join","message.send"]');
