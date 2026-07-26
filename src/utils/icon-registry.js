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
  PreviewOpen,
  PreviewCloseOne,
  Search,
  SettingTwo,
  VideoTwo,
  Down
} from '@icon-park/svg'

// Clean, semantic IconPark registry
const ICON_MAP = {
  down: Down,
  'chevron-down': Down,
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
  eye: PreviewOpen,
  'eye-off': PreviewCloseOne,

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
 * @param {object} options - Configuration options
 * @param {number} [options.size=24] - Icon display size
 * @param {string} [options.primaryColor='currentColor'] - Primary stroke/fill color
 * @param {string} [options.secondaryColor='currentColor'] - Secondary highlight color
 * @returns {string} SVG string
 */
export function getIconSvg (name, {
  size = 24,
  primaryColor = 'currentColor',
  secondaryColor = 'currentColor'
} = {}) {
  if (!name) {
    return ''
  }

  const iconFn = ICON_MAP[name]
  if (!iconFn) {
    return ''
  }

  return iconFn({
    theme: 'multi-color',
    size: size,
    fill: [
      primaryColor !== 'currentColor' ? primaryColor : 'var(--atoll-icon-out-stroke, currentColor)',
      secondaryColor !== 'currentColor' ? secondaryColor : 'var(--atoll-icon-out-fill, var(--atoll-brand-primary, #06C755))',
      'var(--atoll-icon-inner-stroke, #FFFFFF)',
      'var(--atoll-icon-inner-fill, var(--atoll-brand-primary, #06C755))'
    ],
    strokeWidth: 3
  })
}
