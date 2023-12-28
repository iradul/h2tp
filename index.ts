import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as url from 'url';
import * as zlib from 'zlib';

export interface IOptions {
    url: string;
    method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'OPTIONS' | 'CONNECT' | 'PATCH';
    compression?: boolean;
    headers?: { [header: string]: string };
    payload?: any;
    timeout?: number;
    proxy?: string;
    proxyTunneling?: boolean;
    maxRedirs?: number;
    agent?: http.Agent | https.Agent;
    onData?: (chunk: Buffer | string) => void;
    onSocket?: (socket: net.Socket) => void;
    onRequest?: (req: http.ClientRequest) => void;
}

export interface IResult {
    request: http.ClientRequest;
    response: http.IncomingMessage;
    body: string;
    redirections: string[];
}

function addProxyAuthorization(headers: any, proxyUrl: URL) {
    if (proxyUrl.username) {
        headers['proxy-authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`;
    }
    return headers;
}

function proxyTunnelAgent(proxy: string, host: string, port: number) {
    return new Promise<https.Agent>((resolve, reject) => {
        const proxyUrl = new URL(proxy);
        let r = (proxyUrl.protocol === 'https:') ? https.request : http.request;
        r({
            protocol: proxyUrl.protocol,
            host: proxyUrl.hostname,
            port: proxyUrl.port,
            method: 'CONNECT',
            path: `${host}:${port}`,
            headers: addProxyAuthorization({ host }, proxyUrl),
        }).on('connect', (res, socket) => {
            if (res.statusCode === 200) {
                resolve(new https.Agent({ socket }));
            } else {
                reject(new Error(`Proxy tunnel status ${res.statusCode}`));
            }
        }).on('error', (e: any) => {
            reject(e);
        }).end();
    });
}

function execRequest(options: IOptions, config: http.RequestOptions, isHTTPS: boolean) {
    return new Promise<IResult>(async (resolve, reject) => {
        const redirections: string[] = [];
        let responded = false;
        let handled = false;
        let tid: any;
        const handle = () => {
            if (!handled) {
                handled = true;
                clearTimeout(tid);
            }
        }
        let r = (isHTTPS) ? https.request : http.request;
        const req = r(config, (res) => {
            responded = true;
            // handle redirections
            if (res.statusCode >= 300 && res.statusCode <= 399
                && options.maxRedirs > 0 && res.headers['location']) {
                const redirUrl = new URL(options.url, res.headers['location'] as string).toString();
                redirections.push(redirUrl);
                options.url = redirUrl;
                options.maxRedirs--;
                if (options.headers) {
                    delete options.headers['host'];
                }
                handle();
                resolve(httpreq(options));
            } else {
                const zlibOptions = {
                    flush: zlib.constants.Z_SYNC_FLUSH,
                    finishFlush: zlib.constants.Z_SYNC_FLUSH,
                };
                let data = '';
                const
                    onData = options.onData ? options.onData : (chunk: Buffer) => data += chunk.toString(),
                    onEnd = () => {
                        if (!handled) {
                            handle();
                            resolve({
                                request: req,
                                response: res,
                                body: data,
                                redirections,
                            });
                        }
                    },
                    onError = (e: any) => {
                        if (!handled) {
                            handle();
                            reject(e);
                        }
                    };
                switch (res.headers['content-encoding']) {
                    case 'gzip':
                        const gunzip = zlib.createGunzip(zlibOptions);
                        gunzip.on('data', onData);
                        gunzip.on('end', onEnd);
                        gunzip.on('error', onError);
                        res.pipe(gunzip);
                        break;
                    case 'deflate':
                        const inflate = zlib.createInflate(zlibOptions);
                        inflate.on('data', onData);
                        inflate.on('end', onEnd);
                        inflate.on('error', onError);
                        res.pipe(inflate);
                        break;
                    default:
                        res.on('data', onData);
                        res.on('end', onEnd);
                        res.on('error', onError);
                        break;
                }
            }
        });
        req.on('error', (e: any) => {
            if (!responded && !handled) {
                handle();
                reject(e);
            }
        });
        req.on('close', () => {
            if (!responded && !handled) {
                handle();
                reject(new Error(`Connection closed while requesting [${options.method}] ${options.url}`));
            }
        });
        req.once('socket', (socket: net.Socket) => {
            if (options.onSocket) {
                options.onSocket(socket);
            }
        });
        if (options.timeout) {
            tid = setTimeout(() => {
                if (!handled) {
                    req.destroy();
                    handle();
                    reject(new Error(`Timeout [${options.timeout}ms] while requesting [${options.method}] ${options.url}`));
                }
            }, options.timeout)
        }
        if (options.onRequest) {
            options.onRequest(req);
        }
        if (options.payload) req.end(options.payload);
        else req.end();
    });
}

export async function httpreq(opt: IOptions | string): Promise<IResult> {
    const options: IOptions = (typeof opt === 'string') ? { url: opt as string, method: 'GET' } : { ...opt},
        isProxyTunneling = (options.proxyTunneling || options.proxyTunneling === undefined) && /^https/.test(options.url),
        isHTTPS = /^https/.test((options.proxy && !isProxyTunneling) ? options.proxy : options.url),
        serverUrl = new URL(options.proxy && !isProxyTunneling ? options.proxy : options.url),
        headers = {};

    const u = new url.URL(options.url);
    options.url = url.format(u, { auth: false });

    if (options.headers) {
        Object.keys(options.headers).forEach((header) => {
            headers[header.toLowerCase().trim()] = options.headers[header];
        });
    }

    if (!headers['authorization'] && (u.username || u.password)) {
        headers['authorization'] = `Basic ${Buffer.from(`${u.username}:${u.password}`).toString('base64')}`;
    }

    if (!headers['proxy-authorization'] && options.proxy && !isProxyTunneling && serverUrl.username) {
        addProxyAuthorization(headers, serverUrl);
    }

    if (!headers['host']) {
        headers['host'] = new URL(options.url).hostname;
    }

    if ((options.compression || options.compression === undefined) && !headers['accept-encoding']) {
        headers['accept-encoding'] = 'gzip, deflate';
    }

    if (options.timeout === undefined) {
        options.timeout = 120000;
    }

    options.maxRedirs = (options.maxRedirs === undefined) ? 10 : +options.maxRedirs;

    if (typeof options.payload === 'object' && !headers['content-type']) {
        headers['content-type'] = 'application/json';
        options.payload = JSON.stringify(options.payload);
    }

    const config: http.RequestOptions = {
        protocol: serverUrl.protocol,
        host: serverUrl.hostname,
        port: serverUrl.port ? +serverUrl.port : undefined,
        method: options.method,
        path: options.proxy && !isProxyTunneling ? options.url : serverUrl.pathname,
        headers,
    };

    if (options.agent === undefined && options.proxy && isProxyTunneling) {
        config.agent = await proxyTunnelAgent(options.proxy, serverUrl.hostname, +serverUrl.port || 443);
    }

    if (options.agent !== undefined) {
        config.agent = options.agent;
    }
    return execRequest(options, config, isHTTPS);
}
