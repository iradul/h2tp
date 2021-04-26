```js
const H2TP = require("./h2tp");

// simple GET request
H2TP.httpreq('http://example.com').then((r) => console.log(r.body));

// POST request
H2TP.httpreq({
    url: 'http://example.com',
    method: 'POST',
    payload: { data: "dummy" }, // since it's JavaScript object, it will be submitted as [Content-Type:application/json]
}).then((r) => {
    const data = r.body.trim();
    console.log(data);
    process.exit();
}, (err) => {
    console.log("error: " + err);
    process.exit();
});

/*
All options:
{
    url: string;
    method: 'GET'|'HEAD'|'POST'|'PUT'|'DELETE'|'TRACE'|'OPTIONS'|'CONNECT'|'PATCH';
    compression?: boolean;
    headers?: any;
    payload?: any;
    timeout?: number;
    proxy?: string;
    maxRedirs?: number;
    agent?: http.Agent | https.Agent;
    onData?: (chunk: Buffer | string) => void;
    onSocket?: (socket: net.Socket) => void;
    onRequest?: (req: http.ClientRequest) => void;
}
*/

```