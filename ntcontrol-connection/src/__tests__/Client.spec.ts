import { Client, ProtocolMode } from '../Client'
import { CommandType } from '../Types'

describe('Client protocol fallback', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    test('falls back to single-command mode for legacy query-only responders', async () => {
        const client = new Client('127.0.0.1') as any
        const sent: string[] = []

        client.socket = {
            send: (message: string) => {
                sent.push(message)
                return true
            }
        }
        client.token = ''

        const responsePromise = client.sendCommand('QID', CommandType.Ascii)

        expect(sent).toStrictEqual(['20ADZZ;QID\r'])

        await jest.advanceTimersByTimeAsync(500)
        expect(sent).toStrictEqual(['20ADZZ;QID\r', '00QID\r'])

        client.onReceiveLine('00PT-FW300')

        await expect(responsePromise).resolves.toBe('PT-FW300')

        const setPromise = client.sendCommand('PON', CommandType.Ascii)
        expect(sent[sent.length - 1]).toBe('00PON\r')

        await jest.advanceTimersByTimeAsync(500)
        await expect(setPromise).resolves.toBeUndefined()
    })

    test('keeps persistent mode when the projector replies there', async () => {
        const client = new Client('127.0.0.1') as any
        const sent: string[] = []

        client.socket = {
            send: (message: string) => {
                sent.push(message)
                return true
            }
        }
        client.token = ''

        const responsePromise = client.sendCommand('QID', CommandType.Ascii)
        client.onReceiveLine('20PT-DW830E')

        await expect(responsePromise).resolves.toBe('PT-DW830E')
        expect(sent).toStrictEqual(['20ADZZ;QID\r'])

        const setPromise = client.sendCommand('PON', CommandType.Ascii)
        expect(sent[sent.length - 1]).toBe('20ADZZ;PON\r')

        await jest.advanceTimersByTimeAsync(500)
        await expect(setPromise).resolves.toBeUndefined()
    })

    test('emits debug logs for sent commands and received replies', async () => {
        const client = new Client('127.0.0.1')
        const sent: string[] = []
        const debugMessages: string[] = []
        const internalClient = client as any

        internalClient.socket = {
            send: (message: string) => {
                sent.push(message)
                return true
            }
        }
        internalClient.token = ''

        client.on(Client.Events.DEBUG, (message) => {
            debugMessages.push(message)
        })

        const responsePromise = client.sendCommand('QID', CommandType.Ascii)
        internalClient.onReceiveLine('20PT-FW300')

        await expect(responsePromise).resolves.toBe('PT-FW300')
        expect(sent).toStrictEqual(['20ADZZ;QID\r'])
        expect(debugMessages).toContain('Sending command: 20ADZZ;QID\\r')
        expect(debugMessages).toContain('Received reply: 20PT-FW300')
    })

    test('supports explicitly forcing single-command mode', async () => {
        const client = new Client('127.0.0.1', undefined, undefined, undefined, ProtocolMode.SingleCommand) as any
        const sent: string[] = []

        client.socket = {
            send: (message: string) => {
                sent.push(message)
                return true
            }
        }
        client.token = ''

        const responsePromise = client.sendCommand('QID', CommandType.Ascii)
        client.onReceiveLine('00PT-FW300')

        await expect(responsePromise).resolves.toBe('PT-FW300')
        expect(sent).toStrictEqual(['00QID\r'])
    })

    test('supports explicitly forcing persistent mode without fallback', async () => {
        const client = new Client('127.0.0.1', undefined, undefined, undefined, ProtocolMode.Persistent) as any
        const sent: string[] = []

        client.socket = {
            send: (message: string) => {
                sent.push(message)
                return true
            }
        }
        client.token = ''

        const responsePromise = client.sendCommand('QID', CommandType.Ascii)

        await jest.advanceTimersByTimeAsync(500)
        await expect(responsePromise).resolves.toBeUndefined()
        expect(sent).toStrictEqual(['20ADZZ;QID\r'])
    })

    test('uses a lowercase authentication token when sending commands', async () => {
        const client = new Client('127.0.0.1', undefined, 'admin1', 'panasonic', ProtocolMode.Persistent) as any
        const sent: string[] = []

        client.socket = {
            send: (message: string) => {
                sent.push(message)
                return true
            }
        }

        client.onReceiveLine('NTCONTROL 1 12345678')

        const responsePromise = client.sendCommand('QID', CommandType.Ascii)

        await jest.advanceTimersByTimeAsync(500)
        await expect(responsePromise).resolves.toBeUndefined()
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatch(/^[0-9a-f]{32}20ADZZ;QID\r$/)
    })

    test('always terminates sent commands with carriage return', async () => {
        const client = new Client('127.0.0.1', undefined, undefined, undefined, ProtocolMode.SingleCommand) as any
        const sent: string[] = []

        client.socket = {
            send: (message: string) => {
                sent.push(message)
                return true
            }
        }
        client.token = ''

        const responsePromise = client.sendCommand('PON', CommandType.Ascii)

        await jest.advanceTimersByTimeAsync(500)
        await expect(responsePromise).resolves.toBeUndefined()
        expect(sent).toHaveLength(1)
        expect(sent[0].endsWith('\r')).toBe(true)
        expect(sent[0]).toBe('00PON\r')
    })
})