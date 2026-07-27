// src/utils/icon-registry.js
import {
  createIcons,
  AddCircleBoldDuotoneIcon,
  AltArrowDownBoldDuotoneIcon,
  AltArrowRightBoldDuotoneIcon,
  BellBoldDuotoneIcon,
  CameraBoldDuotoneIcon,
  CameraMinimalisticBoldDuotoneIcon,
  CloseCircleBoldDuotoneIcon,
  DocumentsBoldDuotoneIcon,
  EarthBoldDuotoneIcon,
  EyeBoldDuotoneIcon,
  EyeClosedBoldDuotoneIcon,
  FileTextBoldDuotoneIcon,
  GalleryBoldDuotoneIcon,
  LinkCircleBoldDuotoneIcon,
  LockBoldDuotoneIcon,
  LogoutBoldDuotoneIcon,
  MagnifierBoldDuotoneIcon,
  MenuDotsBoldDuotoneIcon,
  MicrophoneBoldDuotoneIcon,
  MutedBoldDuotoneIcon,
  PaperclipBoldDuotoneIcon,
  PhoneBoldDuotoneIcon,
  PlaylistMinimalistic2BoldDuotoneIcon,
  SendSquareBoldDuotoneIcon,
  SettingsBoldDuotoneIcon,
  ShieldKeyholeBoldDuotoneIcon,
  SmileCircleBoldDuotoneIcon,
  UserCircleBoldDuotoneIcon,
  VideocameraBoldDuotoneIcon,
  VideocameraRecordBoldDuotoneIcon,
  Widget2BoldDuotoneIcon
} from '@solar-icons/js'

/**
 *
 */
export function toPascalCase (str) {
  if (!str) {
    return ''
  }
  return str
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Solar BoldDuotone Icon Registry Map
 */
export const SOLAR_ICON_MAP = {
  // Chat Input Actions
  send: SendSquareBoldDuotoneIcon,
  attach: PaperclipBoldDuotoneIcon,
  emoji: SmileCircleBoldDuotoneIcon,

  // Sidebar Menu Items
  gallery: GalleryBoldDuotoneIcon,
  'menu-pictures': GalleryBoldDuotoneIcon,
  'menu-music': PlaylistMinimalistic2BoldDuotoneIcon,
  'menu-videos': VideocameraRecordBoldDuotoneIcon,
  'menu-documents': DocumentsBoldDuotoneIcon,
  'menu-links': LinkCircleBoldDuotoneIcon,

  // Core Navigation & Settings
  music: PlaylistMinimalistic2BoldDuotoneIcon,
  document: FileTextBoldDuotoneIcon,
  link: LinkCircleBoldDuotoneIcon,
  globe: EarthBoldDuotoneIcon,
  logout: LogoutBoldDuotoneIcon,
  settings: SettingsBoldDuotoneIcon,
  'setting-two': SettingsBoldDuotoneIcon,
  search: MagnifierBoldDuotoneIcon,
  remind: BellBoldDuotoneIcon,
  permissions: ShieldKeyholeBoldDuotoneIcon,
  user: UserCircleBoldDuotoneIcon,

  // Messaging & Actions
  add: AddCircleBoldDuotoneIcon,
  more: MenuDotsBoldDuotoneIcon,
  lock: LockBoldDuotoneIcon,
  close: CloseCircleBoldDuotoneIcon,
  eye: EyeBoldDuotoneIcon,
  'eye-off': EyeClosedBoldDuotoneIcon,

  // Call & Media Controls
  mic: MicrophoneBoldDuotoneIcon,
  'mic-off': MutedBoldDuotoneIcon,
  phone: PhoneBoldDuotoneIcon,
  video: VideocameraBoldDuotoneIcon,
  camera: CameraBoldDuotoneIcon,
  'camera-off': CameraMinimalisticBoldDuotoneIcon,
  'pic-in-pic': Widget2BoldDuotoneIcon,

  // Chevrons
  down: AltArrowDownBoldDuotoneIcon,
  'chevron-down': AltArrowDownBoldDuotoneIcon,
  'chevron-right': AltArrowRightBoldDuotoneIcon
}

/**
 * Renders a Solar BoldDuotone icon inside the target wrapper element using createIcons.
 * @param {HTMLElement} wrapper - Container element
 * @param {object} options - Icon render options
 * @param {string} options.name - Semantic icon identifier
 * @param {number} [options.size=24] - Icon display size in pixels
 * @param {string} [options.primaryColor] - Primary stroke/fill color
 * @param {string} [options.secondaryColor] - Secondary highlight color
 */
export function renderIcon (wrapper, {
  name,
  size = 24,
  primaryColor = '',
  secondaryColor = ''
} = {}) {
  if (!wrapper) {
    return
  }
  if (!name) {
    wrapper.innerHTML = ''
    return
  }

  const iconAst = SOLAR_ICON_MAP[name]
  if (!iconAst) {
    wrapper.innerHTML = ''
    return
  }

  const solarKey = toPascalCase(name) + 'Icon'
  wrapper.innerHTML = `<i data-atoll-icon="${name}"></i>`

  const attrs = {
    class: 'atoll-icon-svg',
    size: size
  }

  if (primaryColor) {
    attrs.color = primaryColor
  }
  if (secondaryColor) {
    attrs['secondary-color'] = secondaryColor
  }

  createIcons({
    icons: { [solarKey]: iconAst },
    nameAttr: 'data-atoll-icon',
    attrs
  })
}
