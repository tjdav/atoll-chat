// src/utils/icon-registry.js
import {
  AddCircleLinearIcon,
  AltArrowDownLinearIcon,
  AltArrowLeftLinearIcon,
  BellLinearIcon,
  CameraMinimalisticLinearIcon,
  CheckCircleLinearIcon,
  CheckCircleBoldIcon,
  CheckSquareLinearIcon,
  CheckSquareBoldIcon,
  ClockCircleLinearIcon,
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
  Reorder2BoldIcon,
  CopyLinearIcon,
  CopyBoldIcon,
  DownloadLinearIcon,
  DownloadBoldIcon,
  PlaneBoldIcon,
  TrashBinMinimalisticLinearIcon,
  RestartLinearIcon,
  PlayLinearIcon,
  PauseLinearIcon,
  DangerLinearIcon,
  PenLinearIcon
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
  send: PlaneBoldIcon,
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
  copy: {
    linear: CopyLinearIcon,
    bold: CopyBoldIcon
  },
  download: {
    linear: DownloadLinearIcon,
    bold: DownloadBoldIcon
  },
  more: MenuDotsLinearIcon,
  lock: LockLinearIcon,
  'shield-lock': ShieldKeyholeLinearIcon,
  clock: ClockCircleLinearIcon,
  close: CloseCircleLinearIcon,
  eye: EyeLinearIcon,
  'eye-off': EyeClosedLinearIcon,
  palette: GalleryLinearIcon,
  Aa: FileTextLinearIcon,
  block: MinusCircleLinearIcon,
  bell: BellLinearIcon,
  edit: SettingsLinearIcon,

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

  trash: TrashBinMinimalisticLinearIcon,
  restart: RestartLinearIcon,
  play: PlayLinearIcon,
  pause: PauseLinearIcon,
  warning: DangerLinearIcon,
  pencil: PenLinearIcon,
  camera: CameraMinimalisticLinearIcon,

  // Chevrons
  down: AltArrowDownLinearIcon,
  'chevron-down': AltArrowDownLinearIcon,
  'chevron-left': AltArrowLeftLinearIcon
}

const defaultSvgAttrs = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: '24',
  height: '24',
  viewBox: '0 0 24 24',
  fill: 'none',
  'stroke-width': '1.5'
}

function createSvgNode ([tag, attrs, children]) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  if (attrs) {
    for (const key in attrs) {
      el.setAttribute(key, String(attrs[key]))
    }
  }
  if (children && children.length) {
    for (const child of children) {
      el.appendChild(createSvgNode(child))
    }
  }
  return el
}

/**
 * Creates a standalone SVG Element from a Solar Icon AST node.
 * Does not query or affect any other DOM elements.
 */
export function createSvgElement (iconAst, customAttrs = {}) {
  const attrs = {
    ...defaultSvgAttrs,
    ...customAttrs
  }
  return createSvgNode(['svg', attrs, iconAst])
}

/**
 * Renders a Solar Single-Tone icon directly into the target wrapper element.
 * Supports active Outline vs. Solid state transitions natively without global DOM scanning.
 * @param {HTMLElement} wrapper - Container element
 * @param {object} options - Icon render options
 * @param {string} options.name - Semantic icon identifier
 * @param {number|string} [options.size=24] - Icon display size in pixels
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
    wrapper.replaceChildren()
    return
  }

  let iconAst = SOLAR_ICON_MAP[name]
  if (!iconAst) {
    wrapper.replaceChildren()
    return
  }

  // Support dynamic active/selected state mapping
  if (iconAst && typeof iconAst === 'object' && !Array.isArray(iconAst) && !iconAst.node) {
    iconAst = active ? iconAst.bold : iconAst.linear
  }

  if (!iconAst) {
    wrapper.replaceChildren()
    return
  }

  const sizePx = isNaN(Number(size)) ? size : `${size}px`
  const styleParts = [`width: ${sizePx}`, `height: ${sizePx}`]

  if (primaryColor) {
    styleParts.push(`color: ${primaryColor}`)
    styleParts.push(`--atoll-icon-out-stroke: ${primaryColor}`)
    styleParts.push(`--atoll-icon-primary-color: ${primaryColor}`)
  }

  if (secondaryColor) {
    styleParts.push(`--solar-secondary-color: ${secondaryColor}`)
    styleParts.push(`--atoll-icon-secondary-color: ${secondaryColor}`)
  }

  const svgEl = createSvgElement(iconAst, {
    class: `solar solar-${name} atoll-icon-svg`,
    style: styleParts.join('; '),
    'aria-hidden': 'true'
  })

  wrapper.replaceChildren(svgEl)
}
