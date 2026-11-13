import { describe, expect, it } from 'vitest'
import { create } from 'react-test-renderer'
import { EndingNotice } from './LiveSessionPage'

describe('「측정 종료」 saving notice', () => {
  it('shows a spinner over the camera area only while ending', () => {
    expect(create(<EndingNotice open={false} />).toJSON()).toBeNull()
    const notice = create(<EndingNotice open />).root.findByProps({ role: 'status' })
    expect(notice.props.className).toBe('stage-saving')
    expect(notice.findByProps({ className: 'saving-spinner' })).toBeTruthy()
    expect(notice.findByType('strong').children.join('')).toBe('측정 결과를 저장하고 있어요')
  })
})
