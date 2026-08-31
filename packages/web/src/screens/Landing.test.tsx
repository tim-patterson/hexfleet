import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Landing } from './Landing.js'

describe('Landing', () => {
  it('shows the pitch and the six captain colours', () => {
    const { container } = render(<Landing onJoin={() => {}} onCreate={() => {}} busy={false} error={null} />)
    expect(screen.getByText(/Take the sea/i)).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="palette-dot"]')).toHaveLength(6)
  })

  it('uppercases what the captain types', () => {
    render(<Landing onJoin={() => {}} onCreate={() => {}} busy={false} error={null} />)
    const input = screen.getByPlaceholderText('REEF-42') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'reef-42' } })
    expect(input.value).toBe('REEF-42')
  })

  it('refuses a malformed code without calling onJoin', () => {
    const onJoin = vi.fn()
    render(<Landing onJoin={onJoin} onCreate={() => {}} busy={false} error={null} />)
    fireEvent.change(screen.getByPlaceholderText('REEF-42'), { target: { value: 'NOPE' } })
    fireEvent.click(screen.getByText('Join the table'))
    expect(onJoin).not.toHaveBeenCalled()
    expect(screen.getByText('Table codes are four letters, a dash, then two digits.')).toBeTruthy()
  })

  it('passes a well-formed code up', () => {
    const onJoin = vi.fn()
    render(<Landing onJoin={onJoin} onCreate={() => {}} busy={false} error={null} />)
    fireEvent.change(screen.getByPlaceholderText('REEF-42'), { target: { value: 'kelp-07' } })
    fireEvent.click(screen.getByText('Join the table'))
    expect(onJoin).toHaveBeenCalledWith('KELP-07')
  })

  it('surfaces a server-side join failure', () => {
    render(<Landing onJoin={() => {}} onCreate={() => {}} busy={false} error="No table with that code." />)
    expect(screen.getByText('No table with that code.')).toBeTruthy()
  })

  it('calls onCreate for a new table', () => {
    const onCreate = vi.fn()
    render(<Landing onJoin={() => {}} onCreate={onCreate} busy={false} error={null} />)
    fireEvent.click(screen.getByText('Launch a table'))
    expect(onCreate).toHaveBeenCalled()
  })

  it('shows progress while a table is being set', () => {
    render(<Landing onJoin={() => {}} onCreate={() => {}} busy error={null} />)
    expect(screen.getByText('Setting a table…')).toBeTruthy()
  })
})
