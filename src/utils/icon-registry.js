// src/utils/icon-registry.js
import {
  AddOne,
  Airplay,
  Camera,
  CloseOne,
  FileText,
  Globe,
  LinkOne,
  Lock,
  Logout,
  Microphone,
  MoreTwo,
  MusicMenu,
  OffScreen,
  Phone,
  Search,
  SettingTwo,
  VideoTwo
} from '@icon-park/svg'

// Clean, semantic IconPark registry
const ICON_MAP = {
  // Core Navigation
  music: MusicMenu,
  document: FileText,
  link: LinkOne,
  globe: Globe,
  logout: Logout,
  settings: SettingTwo,
  search: Search,

  // Messaging & Actions
  add: AddOne,
  more: MoreTwo,
  lock: Lock,
  close: CloseOne,

  // Call & Media Controls
  mic: Microphone,
  'mic-off': OffScreen,
  phone: Phone,
  video: VideoTwo,
  camera: Camera,
  'camera-off': OffScreen,
  'pic-in-pic': Airplay
}

/**
 * Generates two-tone SVG content using IconPark functions.
 * @param {string} name - Semantic icon identifier
 * @param {object} options
 * @returns {string} SVG string
 */
export function getIconSvg (name, { size = 24, primaryColor = 'currentColor', secondaryColor = 'currentColor' } = {}) {
  if (!name) {
    return ''
  }

  const iconFn = ICON_MAP[name]
  if (!iconFn) {
    return ''
  }

  return iconFn({
    theme: 'two-tone',
    size: size,
    fill: [primaryColor, secondaryColor],
    strokeWidth: 3
  })
}
