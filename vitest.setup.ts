import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest 未啟用 globals，RTL 不會自動註冊 cleanup，需手動掛上。
afterEach(() => {
  cleanup()
})
