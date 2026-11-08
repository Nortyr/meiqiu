import type { MeiqiuApi } from '../shared/types'

declare global {
  interface Window {
    api: MeiqiuApi
  }
}
