import * as crypto from 'crypto'
import { EventEmitter } from 'events'

import { TcpClient } from './TcpClient'
import { ResponseCode, getResponseDescription } from './Responses'
import { CommandType } from './Types'

const DEFAULT_PORT: number = 1024
const PROTOCOL_LINE_BREAK: string = '\r'

const AUTO_RESOLVE_TIME: number = 500

enum ProtocolPrefix {
    SINGLE_COMMAND_ASCII = '00',
    SINGLE_COMMAND_BINARY = '01',
    PERSISTENT_ASCII = '20',
    PERSISTENT_BIN = '21'
}

export enum ProtocolMode {
    Auto = 'auto',
    Persistent = 'persistent',
    SingleCommand = 'single-command'
}

interface InternalPromise {
    resolve: (d?: any) => void
    reject: (err: Error) => void
}

/**
 * NT CONTROL connection client.
 */
export class Client extends EventEmitter {

    private host: string

    private port: number

    private user: string | undefined

    private password: string | undefined

    private cmdStack: InternalPromise[]

    private socket: TcpClient | undefined

    private token: string | undefined

    private receivebuffer: string = ''

    private reportConnectionError: boolean = true

    private configuredProtocolMode: ProtocolMode = ProtocolMode.Auto

    private protocolMode: ProtocolMode = ProtocolMode.Persistent

    /**
     * Connected state (including initial handshake)
     */
    public connected: boolean = false

    /**
     * Enumeration of events emitted by the class.
     */
    public static Events = {
        CONNECT: 'connect',
        DISCONNECT: 'disconnect',
        DATA: 'data',
        END: 'end',
        DEBUG: 'debug',
        AUTHENTICATION_ERROR: 'auth_error'
    }

    /**
     * Creates a new NT CONTROL client.
     * @param host      NT CONTROL host/ip address
     * @param port      Port of the NT CONTROL host (default: 1024)
     * @param user      The user (default: 'admin1')
     * @param password  The password (default: 'panasonic')
     */
    constructor (host: string, port?: number, user?: string, password?: string, protocolMode: ProtocolMode = ProtocolMode.Auto) {
        super()

        this.host = host
        this.port = port || DEFAULT_PORT
        this.user = user
        this.password = password
        this.cmdStack = []
        this.setProtocolMode(protocolMode)
    }

    public connect () {
        if (this.socket !== undefined && this.socket.connected === true && this.connected === true) {
            this.emit(Client.Events.DEBUG, 'socket already connected')
            return
        }

        this.destroy()

        this.protocolMode = this.getInitialProtocolMode()

        this.socket = new TcpClient(this.host, this.port, { reconnect: false })

        if (this.host) {
            this.socket.on('error', (err) => {
                if (err && this.reportConnectionError) {
                    this.emit(Client.Events.DEBUG, 'Network error: ' + err)
                    this.reportConnectionError = false
                }

                // Destroy and reconnect (reject all pending responses).
                this.connect()
            })

            this.socket.on('timeout', () => {
                this.emit(Client.Events.DEBUG, 'socket timeout')

                // Some projectors can keep the socket open during normal polling gaps.
                // Only force a reconnect if transport or handshake is no longer healthy.
                if (this.socket === undefined || this.socket.connected !== true || this.connected !== true) {
                    this.connect()
                }
            })

            this.socket.on('connect', () => {
                this.emit(Client.Events.DEBUG, 'socket connect')
                this.reportConnectionError = true
            })

            this.socket.on('end', () => {
                this.connected = false
                this.emit(Client.Events.DEBUG, 'socket end')
                this.emit(Client.Events.DISCONNECT)
                this.emit(Client.Events.END)
            })

            // separate buffered stream into lines with responses
            this.socket.on('data', (chunk) => this.onData(chunk))
            this.socket.on('receiveline', (line) => this.onReceiveLine(line))

            this.socket.connect()
        }
    }

    /**
     * Set authentication information for the connection
     * @param user      The username (default: 'admin1')
     * @param password  The password (default: 'panasonic')
     */
    public setAuthentication (user: string | undefined, password: string | undefined): void {
        this.user = user
        this.password = password
    }

    public setProtocolMode (protocolMode: ProtocolMode = ProtocolMode.Auto): void {
        this.configuredProtocolMode = protocolMode
        this.protocolMode = this.getInitialProtocolMode()
    }

    private setToken (salt: string): void {
        if (salt) {
            const user = this.user || ''
            const password = this.password || ''
            this.token = crypto.createHash('md5')
                .update(user + ':' + password + ':' + salt, 'ascii')
                .digest('hex')
        } else {
            this.token = ''
        }
    }

    private onData (chunk: string): void {
        let i = 0
        let line = ''
        let offset = 0
        this.receivebuffer += chunk

        while (1) {
            i = this.receivebuffer.indexOf(PROTOCOL_LINE_BREAK, offset)
            if (i === -1) break

            line = this.receivebuffer.substr(offset, i - offset)
            offset = i + 1

            if (this.socket !== undefined) {
                this.socket.emit('receiveline', line.toString())
            }
        }

        this.receivebuffer = this.receivebuffer.substr(offset)
    }

    private onReceiveLine (line: string): void {
        if (line.substring(0, 10) === 'NTCONTROL ') {
            // Greeting after connection setup
            this.emit(Client.Events.DEBUG, 'Received greeting: ' + line)

            let salt = ''
            if (line[10] === '1') {
                salt = line.substring(12)
            } else if (line[10] !== '0') {
                this.emit(Client.Events.DEBUG, 'Unkown greeting: ' + line)
            }

            this.setToken(salt)
            this.connected = true
            this.emit(Client.Events.CONNECT)

        } else if (Object.values(ProtocolPrefix).includes(line.substring(0, 2) as ProtocolPrefix)) {
            // Usual response
            this.emit(Client.Events.DEBUG, 'Received reply: ' + line)
            const response = line.substring(2)

            const promise = this.cmdStack.shift()

            switch (response) {
                case ResponseCode.ERR1:
                case ResponseCode.ERR2:
                case ResponseCode.ERR3:
                case ResponseCode.ERR4:
                case ResponseCode.ERR5:
                case ResponseCode.ER401:
                    if (promise !== undefined) {
                        promise.reject(new Error(response))
                    }
                    break
                case ResponseCode.ERRA:
                    this.emit(Client.Events.AUTHENTICATION_ERROR)
                    if (promise !== undefined) {
                        promise.reject(new Error(response))
                    }
                    break
                default:
                    this.emit(Client.Events.DATA, response)
                    if (promise !== undefined) {
                        promise.resolve(response)
                    }
                    break
            }
        } else if (Object.values(ResponseCode).includes(line as ResponseCode)) {
            this.emit(Client.Events.DEBUG, 'Received error reply: ' + line)

            const promise = this.cmdStack.shift()

            switch (line) {
                case ResponseCode.ERRA:
                    this.emit(Client.Events.AUTHENTICATION_ERROR)
                    if (promise !== undefined) {
                        promise.reject(new Error(line))
                    }
                    break
                default:
                    if (promise !== undefined) {
                        const description = getResponseDescription(line as ResponseCode)
                        promise.reject(new Error(description))
                    }
                    break
            }
        } else {
            this.emit(Client.Events.DEBUG, 'Unkown data received: ' + line)
        }
    }

    /**
     * Sends a command to the NT CONTROL host.
     * @param cmd   The command string (without CR at the end)
     * @param type  The command type (binary vs. ascii)
     * @returns     A promise with the response (string) from the host.
     */
    public sendCommand (cmd: string, type: CommandType = CommandType.Binary): Promise<string | undefined> {
        if (this.socket !== undefined) {
            return this.sendCommandWithFallback(cmd, type)
        } else {
            return Promise.reject(new Error('No socket.'))
        }
    }

    /**
     * Closes the underlying TCP connection.
     */
    public destroy () {
        if (this.socket !== undefined) {
            this.socket.removeAllListeners()
            this.socket.destroy()
            delete this.socket

            this.connected = false
            this.emit(Client.Events.DISCONNECT)

            // Resolve all pending requests.
            let promise = this.cmdStack.shift()
            while (promise !== undefined) {
                promise.reject(new Error('Socket closed.'))
                promise = this.cmdStack.shift()
            }
        }
    }

    private autoResolve (promise: InternalPromise) {
        const index = this.cmdStack.indexOf(promise)
        if (index >= 0) {
            this.cmdStack.splice(index, 1)
            promise.resolve()
        }
    }

    private sendCommandWithFallback (cmd: string, type: CommandType): Promise<string | undefined> {
        const useFallback = this.configuredProtocolMode === ProtocolMode.Auto && this.protocolMode === ProtocolMode.Persistent && type === CommandType.Ascii && cmd.startsWith('Q')

        return this.sendCommandInternal(cmd, type, this.protocolMode)
            .then((response) => {
                if (!useFallback || response !== undefined) {
                    return response
                }

                return this.sendCommandInternal(cmd, type, ProtocolMode.SingleCommand)
                    .then((fallbackResponse) => {
                        if (fallbackResponse !== undefined) {
                            this.protocolMode = ProtocolMode.SingleCommand
                        }

                        return fallbackResponse
                    })
            })
    }

    private sendCommandInternal (cmd: string, type: CommandType, mode: ProtocolMode): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            if (this.socket !== undefined) {
                const canConnect = typeof (this.socket as any).connect === 'function'
                if (canConnect && (this.socket.connected !== true || this.connected !== true)) {
                    // Retry this command once the handshake is complete.
                    this.once(Client.Events.CONNECT, () => this.sendCommand(cmd, type).then(resolve, reject))
                    this.connect()
                    return
                }

                try {
                    const formatted = this.formatCommand(cmd, type, mode)
                    this.emit(Client.Events.DEBUG, 'Sending command: ' + formatted.replace('\r', '\\r'))
                    this.socket.send(formatted)

                    const promiseRef = { resolve, reject }
                    this.cmdStack.push(promiseRef)

                    // Automatically resolve promise, if no response is received (not all cmds generate a response, but all might end with an error)
                    setTimeout(() => this.autoResolve(promiseRef), AUTO_RESOLVE_TIME)
                } catch (e) {
                    this.emit(Client.Events.DEBUG, 'Error sending data: ' + e)

                    // retry
                    this.once(Client.Events.CONNECT, () => this.sendCommand(cmd, type).then(resolve, reject))

                    // restart connection
                    this.connect()
                }
            }
        })
    }

    private formatCommand (cmd: string, type: CommandType, mode: ProtocolMode): string {
        const token = this.token || ''

        if (mode === ProtocolMode.SingleCommand) {
            const prefix = (type === CommandType.Binary) ? ProtocolPrefix.SINGLE_COMMAND_BINARY : ProtocolPrefix.SINGLE_COMMAND_ASCII
            return token + prefix + cmd + PROTOCOL_LINE_BREAK
        }

        const prefix = (type === CommandType.Binary) ? ProtocolPrefix.PERSISTENT_BIN : ProtocolPrefix.PERSISTENT_ASCII
        return token + prefix + 'ADZZ;' + cmd + PROTOCOL_LINE_BREAK
    }

    private getInitialProtocolMode (): ProtocolMode {
        return this.configuredProtocolMode === ProtocolMode.SingleCommand
            ? ProtocolMode.SingleCommand
            : ProtocolMode.Persistent
    }
}
