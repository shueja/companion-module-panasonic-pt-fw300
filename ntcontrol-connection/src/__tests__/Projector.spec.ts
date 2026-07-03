import { Projector } from '../Projector'

describe('Projector optional metadata queries', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    test('disables unsupported model query after ERR1 and does not retry it on reconnect', async () => {
        const sent: string[] = []
        const logs: string[] = []
        const connection = {
            connected: true,
            on: jest.fn(),
            sendCommand: jest.fn((cmd: string) => {
                sent.push(cmd)

                if (cmd === 'QID') {
                    return Promise.reject(new Error('ERR1'))
                }

                if (cmd === 'QVX:NCGS8') {
                    return Promise.reject(new Error('ERR1'))
                }

                return Promise.resolve(undefined)
            })
        }

        const projector = new Projector(connection as any, (level, message) => {
            logs.push(level + ':' + message)
        })

        await Promise.resolve()
        await Promise.resolve()

        expect(sent).toContain('QID')
        expect(logs).toContain('debug:Skipping unsupported metadata query: ModelName')

        const modelQueryCount = sent.filter((cmd) => cmd === 'QID').length

        projector.updateConnection(connection as any)

        await Promise.resolve()
        await Promise.resolve()

        expect(sent.filter((cmd) => cmd === 'QID')).toHaveLength(modelQueryCount)
    })
})