import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as url from 'url';
import * as zlib from 'zlib';

export interface IOptions {
    url: string;
    method: 'GET'|'HEAD'|'POST'|'PUT'|'DELETE'|'TRACE'|'OPTIONS'|'CONNECT'|'PATCH';
    compression?: boolean;
    headers?: { [header: string]: string };
    payload?: any;
    timeout?: number;
    proxy?: string;
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

export function httpreq(opt: IOptions | string): Promise<IResult> {
    return new Promise<IResult>((resolve, reject) => {
        const options: IOptions = (typeof opt === 'string') ? { url: opt as string, method: 'GET' } : opt,
            isHTTPS = /^https/.test(options.proxy || options.url),
            serverUrl = url.parse(options.proxy ? options.proxy : options.url),
            headers = {};
        let handled = false;

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

        if (!headers['host']) {
            headers['host'] = url.parse(options.url).host;
        }

        if (options.compression && !headers['accept-encoding']) {
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
            path: options.proxy ? options.url : serverUrl.path,
            headers,
        };

        if (options.agent !== undefined) {
            config.agent = options.agent;
        }

        const redirections: string[] = [];

        const r = (isHTTPS) ? https.request : http.request;
        const req = r(config, (res) => {
            // handle redirections
            if (res.statusCode >= 300 && res.statusCode <= 399
                && options.maxRedirs > 0 && res.headers['location']) {
                const redirUrl = url.resolve(options.url, res.headers['location'] as string);
                redirections.push(redirUrl);
                options.url = redirUrl;
                options.maxRedirs--;
                delete headers['host'];
                handled = true;
                resolve(httpreq(options));
            } else {
                const zlibOptions = {
                    flush: zlib.Z_SYNC_FLUSH,
                    finishFlush: zlib.Z_SYNC_FLUSH,
                };
                let data = '';
                const
                    onData = options.onData ? options.onData : (chunk: Buffer) => data += chunk.toString(),
                    onEnd = () => {
                        handled = true;
                        resolve({
                            request: req,
                            response: res,
                            body: data,
                            redirections,
                        });
                    },
                    onError = (e: any) => reject(e);
                switch (res.headers['content-encoding']) {
                    case 'gzip':
                        handled = true;
                        const gunzip = zlib.createGunzip(zlibOptions);
                        gunzip.on('data', onData);
                        gunzip.on('end', onEnd);
                        gunzip.on('error', onError);
                        res.pipe(gunzip);
                        break;
                    case 'deflate':
                        handled = true;
                        const inflate = zlib.createInflate(zlibOptions);
                        gunzip.on('data', onData);
                        gunzip.on('end', onEnd);
                        gunzip.on('error', onError);
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
        req.on('error', (e: any) => reject(e));
        req.on('close', () => {
            if (!handled) {
                reject(new Error(`Connection closed while requesting [${options.method}] ${options.url}`));
            }
        });
        req.once('socket', (socket: net.Socket) => {
            if (options.onSocket) {
                options.onSocket(socket);
            }
            if (options.timeout) {
                socket.setTimeout(options.timeout);
                socket.on('timeout', () => req.abort());
            }
        });
        if (options.onRequest) {
            options.onRequest(req);
        }
        if (options.payload) req.end(options.payload);
        else req.end();
    });
}
