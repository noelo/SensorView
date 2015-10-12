require('es6-promise').polyfill();
var OAuth = require('oauth');
var qs = require('querystring');
var request = require("request");
var events = require('events');
var influent = require('influent');

var ee = new events.EventEmitter();

var oauth = new OAuth.OAuth(
    'http://api.cubesensors.com/auth/request_token',
    'http://api.cubesensors.com/auth/access_token',
    process.env.oauth_consumer_key,
    process.env.oauth_consumer_secret,
    '1.0',
    null,
    'HMAC-SHA1'
);

var dbclient;
var cubeNames = {};

ee.on("CurrentValue", function (sensorvalue) {
    console.log("Writing data");
    dbclient.writeOne({
        key: "Sensordata",
        tags: {
            cubeid: sensorvalue.cubeid,
            cubenname:sensorvalue.cubename
        },
        fields: {
            temp: sensorvalue.temp,
            pressure: sensorvalue.pressure,
            light: sensorvalue.light,
            noise: sensorvalue.noisedba,
            source: "CubeSensor"
        }
    });
});

ee.on("SpanValue", function (sensorvalue) {
    console.log("SpanValue", sensorvalue);
});


ee.on("PrepDB", function () {
    console.log("Init DB");
    influent
        .createClient({
            username: process.env.dbusername,
            password: process.env.dbpassword,
            database: "SensorsDB",
            server: [
                {
                    protocol: "http",
                    host: process.env.dbhost,
                    port: Number(process.env.dbport)
                }
            ]
        }).
        then(function (client) {
            dbclient = client;
        });
});

var oauth_tokens = {
    consumer_key: process.env.oauth_consumer_key,
    consumer_secret: process.env.oauth_consumer_secret,
    token: process.env.oauth_token,
    token_secret: process.env.oauth_secret
}, cubeDevices = [];

function combineData(element, index) {
    this.out[this.field_lists[index]] = element;

}

function getCubeSensorInfo() {
    requrl = "http://api.cubesensors.com/v1/devices/";
    request.get({
        url: requrl,
        oauth: oauth_tokens,
        qs: qs,
        json: true
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            console.log(body);
            body.devices.forEach(function (cube) {
                cubeDevices.push({"cubeid": cube.uid, "cubename": cube.extra.name});
                console.log("CubeId", cube.uid);
                console.log("CubeName", cube.extra.name);
            })
        } else {
            console.error(error, response);
        }
    });
}


function getCubeSensorCurrentData() {
    cubeDevices.forEach(function (cube) {
        requrl = "http://api.cubesensors.com/v1/devices/" + cube.cubeid + "/current";
        request.get({
            url: requrl,
            oauth: oauth_tokens,
            qs: qs,
            json: true
        }, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var tmp = {};
                tmp.field_lists = body.field_list;
                tmp.out = {};
                body.results[0].forEach(combineData, tmp);
                tmp.out.cubeid = cube.cubeid;
                tmp.out.cubename = cube.cubename;

                ee.emit("CurrentValue", tmp.out);
            } else {
                console.error(error, response);
            }
        })
    });
}


function getCubeSensorSpanData() {

    var today = new Date();
    var yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    params = {};
    params.start = yesterday.toISOString(today).slice(0, -5) + 'Z';
    params.end = today.toISOString(today).slice(0, -5) + 'Z';

    cubeDevices.forEach(function (cube) {
        requrl = "http://api.cubesensors.com/v1/devices/" + cube.cubeid + "/span";
        request.get({
            url: requrl,
            oauth: oauth_tokens,
            qsStringifyOptions: params,
            useQuerystring: true,
            json: true
        }, function (err, response, body) {
            if (!err && response.statusCode == 200) {
                var tmp = {};
                tmp.field_lists = body.field_list;
                tmp.out = {};
                body.results.forEach(function (element) {
                    element.forEach(combineData, tmp);
                    tmp.out.cubeid = cube.cubeid;
                    tmp.out.cubename = cube.cubename;
                    ee.emit("SpanValue", tmp.out);
                }, tmp);
            }
        })
    })
}

ee.emit("PrepDB");


function periodicPull() {
    setInterval(function () {
        getCubeSensorCurrentData()
    }, 10000);
}

getCubeSensorInfo();
periodicPull();

//getCurrentData();
//getSpanData();


