// src/utils/icon-registry.js
import {
  createIcons,
  AddCircleLinearIcon,
  AltArrowDownLinearIcon,
  AltArrowLeftLinearIcon,
  AltArrowRightLinearIcon,
  BellLinearIcon,
  CameraMinimalisticLinearIcon,
  CheckCircleLinearIcon,
  CheckCircleBoldIcon,
  CheckSquareLinearIcon,
  CheckSquareBoldIcon,
  CloseCircleLinearIcon,
  DocumentsLinearIcon,
  DocumentsBoldIcon,
  EarthLinearIcon,
  HamburgerMenuLinearIcon,
  HamburgerMenuBoldIcon,
  EyeLinearIcon,
  EyeClosedLinearIcon,
  FileTextLinearIcon,
  FileTextBoldIcon,
  GalleryLinearIcon,
  GalleryBoldIcon,
  LinkCircleLinearIcon,
  LinkCircleBoldIcon,
  LockLinearIcon,
  LogoutLinearIcon,
  MagnifierLinearIcon,
  MenuDotsLinearIcon,
  MicrophoneLinearIcon,
  MinusCircleLinearIcon,
  MinusCircleBoldIcon,
  MutedLinearIcon,
  PaperclipLinearIcon,
  PhoneLinearIcon,
  PlaylistMinimalistic2LinearIcon,
  PlaylistMinimalistic2BoldIcon,
  Reorder2LinearIcon,
  SendSquareLinearIcon,
  SettingsLinearIcon,
  ShieldKeyholeLinearIcon,
  SmileCircleLinearIcon,
  UserCircleLinearIcon,
  VideocameraLinearIcon,
  VideocameraBoldIcon,
  VideocameraRecordLinearIcon,
  VideocameraRecordBoldIcon,
  PipLinearIcon,
  Reorder2BoldIcon
} from '@solar-icons/js'

/**
 * Helper to convert kebab-case to PascalCase
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
 * Solar Icon Registry Map matching single-tone state duality guidelines
 */
export const SOLAR_ICON_MAP = {
  // Chat Input Actions (Static Controls)
  send: SendSquareLinearIcon,
  attach: PaperclipLinearIcon,
  emoji: SmileCircleLinearIcon,

  // Sidebar Menu Items & Main Views (State Duality Pairs)
  gallery: {
    linear: GalleryLinearIcon,
    bold: GalleryBoldIcon
  },
  'menu-pictures': {
    linear: GalleryLinearIcon,
    bold: GalleryBoldIcon
  },
  'menu-music': {
    linear: PlaylistMinimalistic2LinearIcon,
    bold: PlaylistMinimalistic2BoldIcon
  },
  'menu-videos': {
    linear: VideocameraRecordLinearIcon,
    bold: VideocameraRecordBoldIcon
  },
  'menu-documents': {
    linear: DocumentsLinearIcon,
    bold: DocumentsBoldIcon
  },
  'menu-links': {
    linear: LinkCircleLinearIcon,
    bold: LinkCircleBoldIcon
  },

  // Core Navigation & Settings
  music: {
    linear: PlaylistMinimalistic2LinearIcon,
    bold: PlaylistMinimalistic2BoldIcon
  },
  document: {
    linear: FileTextLinearIcon,
    bold: FileTextBoldIcon
  },
  link: {
    linear: LinkCircleLinearIcon,
    bold: LinkCircleBoldIcon
  },
  globe: EarthLinearIcon,
  logout: LogoutLinearIcon,
  settings: SettingsLinearIcon,
  'setting-two': SettingsLinearIcon,
  search: MagnifierLinearIcon,
  remind: BellLinearIcon,
  permissions: ShieldKeyholeLinearIcon,
  user: UserCircleLinearIcon,

  // Messaging & Actions
  add: AddCircleLinearIcon,
  more: MenuDotsLinearIcon,
  lock: LockLinearIcon,
  close: CloseCircleLinearIcon,
  eye: EyeLinearIcon,
  'eye-off': EyeClosedLinearIcon,

  // Call & Media Controls
  check: {
    linear: CheckSquareLinearIcon,
    bold: CheckSquareBoldIcon
  },
  'check-circle': {
    linear: CheckCircleLinearIcon,
    bold: CheckCircleBoldIcon
  },
  'minus-circle': {
    linear: MinusCircleLinearIcon,
    bold: MinusCircleBoldIcon
  },
  'circle-minus': {
    linear: MinusCircleLinearIcon,
    bold: MinusCircleBoldIcon
  },
  'hamburger-menu': {
    linear: HamburgerMenuLinearIcon,
    bold: HamburgerMenuBoldIcon
  },
  reorder: {
    linear: Reorder2LinearIcon,
    bold: Reorder2BoldIcon
  },
  mic: MicrophoneLinearIcon,
  'mic-off': MutedLinearIcon,
  phone: PhoneLinearIcon,
  'phone-hangup': PhoneLinearIcon,
  videocam: {
    linear: VideocameraLinearIcon,
    bold: VideocameraBoldIcon
  },
  'camera-off': CameraMinimalisticLinearIcon,
  pip: PipLinearIcon,

  // Chevrons
  down: AltArrowDownLinearIcon,
  'chevron-down': AltArrowDownLinearIcon,
  'chevron-left': AltArrowLeftLinearIcon,
  'chevron-right': AltArrowRightLinearIcon
}

/**
 * Renders a Solar Single-Tone icon inside the target wrapper element using createIcons.
 * Supports active Outline vs. Solid state transitions natively.
 * @param {HTMLElement} wrapper - Container element
 * @param {object} options - Icon render options
 * @param {string} options.name - Semantic icon identifier
 * @param {number} [options.size=24] - Icon display size in pixels
 * @param {string} [options.primaryColor] - Primary stroke/fill color
 * @param {string} [options.secondaryColor] - Secondary highlight color
 * @param {boolean} [options.active=false] - Whether the icon should render in its active/bold state
 */
export function renderIcon (wrapper, {
  name,
  size = 24,
  primaryColor = '',
  secondaryColor = '',
  active = false
} = {}) {
  if (!wrapper) {
    return
  }
  if (!name) {
    wrapper.innerHTML = ''
    return
  }

  let iconAst = SOLAR_ICON_MAP[name]
  if (!iconAst) {
    wrapper.innerHTML = ''
    return
  }

  // Support dynamic active/selected state mapping
  if (iconAst && typeof iconAst === 'object' && !Array.isArray(iconAst) && !iconAst.node) {
    iconAst = active ? iconAst.bold : iconAst.linear
  }

  if (!iconAst) {
    wrapper.innerHTML = ''
    return
  }

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

  /* Use a Proxy as the icons dictionary to automatically resolve any rendered icon's AST
     This prevents console warnings when multiple different icons exist on the page */
  const iconsProxy = new Proxy({}, {
    get (target, prop) {
      if (typeof prop !== 'string') {
        return undefined
      }
      const baseNameCamel = prop.endsWith('Icon') ? prop.slice(0, -4) : prop
      const mapKey = Object.keys(SOLAR_ICON_MAP).find(k => {
        return toPascalCase(k) === baseNameCamel
      })

      if (!mapKey) {
        return undefined
      }
      let ast = SOLAR_ICON_MAP[mapKey]
      if (ast && typeof ast === 'object' && !Array.isArray(ast) && !ast.node) {
        return ast.linear
      }
      return ast
    }
  })

  /* To ensure the specifically being rendered icon is resolved with the correct active/bold state: */
  const solarKey = toPascalCase(name) + 'Icon'
  iconsProxy[solarKey] = iconAst

  createIcons({
    icons: iconsProxy,
    nameAttr: 'data-atoll-icon',
    attrs
  })
}
