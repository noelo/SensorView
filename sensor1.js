require('es6-promise').polyfill();
var OAuth = require('oauth');
var qs = require('querystring');
var request = require("request");
var events = require('events');
var influent = require('influent');
var async = require("async");
var express = require('express');
var app = express();


var processing_status = 200;


app.get('/', function (req, res) {
    res.sendStatus(processing_status);
});

var server = app.listen(8080, function () {
    var host = server.address().address;
    var port = server.address().port;

    console.log('Sensor App status listening at http://%s:%s', host, port);
});


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

var oauth_tokens = {
    consumer_key: process.env.oauth_consumer_key,
    consumer_secret: process.env.oauth_consumer_secret,
    token: process.env.oauth_token,
    token_secret: process.env.oauth_secret
}, cubeDevices = [];

var dbclient;
var prevWANRecData = 0;
var prevWANTransData = 0;

ee.on("WANStats", function (WANData) {
    var toStore = {rec: 0, trans: 0};

    //Process receive data
    if (prevWANRecData !== 0) {
        toStore.rec = WANData.receive - prevWANRecData;
        toStore.rec = (toStore.rec > 0) ? toStore.rec : 0;
        prevWANRecData = WANData.receive;
    }
    prevWANRecData = WANData.receive;

    //Process transmit data
    if (prevWANTransData !== 0) {
        toStore.trans = WANData.transmit - prevWANTransData;
        toStore.trans = (toStore.trans > 0) ? toStore.trans : 0;
    }
    prevWANTransData = WANData.transmit;

    dbclient.writeOne({
        key: "NetworkData",
        tags: {
            router: "WANROUTER"
        },
        fields: {
            receive: toStore.rec,
            transmit: toStore.trans,
            source: "WAN"
        }
    }).then(function () {
        processing_status = 200;
    }).catch(
        function (reason) {
            console.log('WANStats Failed to write to DB (' + reason + ') here.');
            processing_status = 500;
        });
});


ee.on("CurrentValue", function (sensorvalue) {
    console.log("Writing sensor data");
    dbclient.writeOne({
        key: "Sensordata",
        tags: {
            cubeid: sensorvalue.cubeid,
            cubenname: sensorvalue.cubename
        },
        fields: {
            temp: sensorvalue.temp,
            pressure: sensorvalue.pressure,
            light: sensorvalue.light,
            noise: sensorvalue.noisedba,
            source: "CubeSensor"
        }
    }).then(function () {

            processing_status = 200;
        }
    ).catch(
        function (reason) {
            console.log('CurrentValue Failed to write to DB (' + reason + ') here.');
            processing_status = 500;
        });
})
;

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
                    host: process.env.EXTERNAL_INFLUXDB_SVC_SERVICE_HOST,
                    port: Number(process.env.EXTERNAL_INFLUXDB_SVC_SERVICE_PORT)
                }
            ]
        }).
        then(function (client) {
            dbclient = client;
        }).catch(
        function (reason) {
            console.log('Failed to get influxdb client', reason);
            processing_status = 500;
        });
});


function combineData(element, index) {
    this.out[this.field_lists[index]] = element;

}

function getCubeSensorInfo() {
    var requrl = "http://api.cubesensors.com/v1/devices/";
    request.get({
        url: requrl,
        oauth: oauth_tokens,
        qs: qs,
        json: true
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            processing_status = 200;
            console.log(body);
            body.devices.forEach(function (cube) {
                cubeDevices.push({"cubeid": cube.uid, "cubename": cube.extra.name});
                console.log("CubeId", cube.uid);
                console.log("CubeName", cube.extra.name);
            })
        } else {
            console.error("getCubeSensorInfo ", error, response);
            processing_status = 500;
        }
    });
}


function getCubeSensorCurrentData() {
    cubeDevices.forEach(function (cube) {
        var requrl = "http://api.cubesensors.com/v1/devices/" + cube.cubeid + "/current";
        request.get({
                url: requrl,
                oauth: oauth_tokens,
                qs: qs,
                json: true
            }, function (error, response, body) {
                if (error) {
                    console.error("getCubeSensorCurrentData ", error, response);
                    processing_status = 500;
                } else {
                    switch (response.statusCode) {
                        case 200:
                            processing_status = 200;
                            var tmp = {};
                            tmp.field_lists = body.field_list;
                            tmp.out = {};
                            body.results[0].forEach(combineData, tmp);
                            tmp.out.cubeid = cube.cubeid;
                            tmp.out.cubename = cube.cubename;

                            ee.emit("CurrentValue", tmp.out);
                            break;
                        case 429:
                            processing_status = 200;
                            console.log("Rate limited...");
                            break;
                        default:
                            console.log("getCubeSensorCurrentData Unhandled response code " + response);
                    }
                }
            }
        )
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
        var requrl = "http://api.cubesensors.com/v1/devices/" + cube.cubeid + "/span";
        request.get({
            url: requrl,
            oauth: oauth_tokens,
            qsStringifyOptions: params,
            useQuerystring: true,
            json: true
        }, function (err, response, body) {
            if (!err && response.statusCode == 200) {
                processing_status = 200;
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

function getWanStats() {
    var wanData = {};
    var reqURLs = [
        {
            type: "transmit",
            url: "http://192.168.1.1/getWanTransmit.sh"
        },
        {
            type: "receive",
            url: "http://192.168.1.1/getWanReceive.sh"
        }
    ];
    async.each(reqURLs,
        function (url, callback) {
            request.get(url.url, {
                    'auth': {
                        'user': 'admin',
                        'pass': 'admin',
                        'sendImmediately': true
                    }
                }, function (err, response, body) {
                    if (!err && response.statusCode == 200) {
                        wanData[url.type] = Number(body.substring(0, body.length - 1));
                    } else {
                        console.log("getWanStats: An error occurred during GET ", err)

                    }
                    callback();
                }
            )
        }, function done(err) {
            if (err) {
                console.log("getWanStats: An error occurred ", err);
                processing_status = 500;
            } else {
                processing_status = 200;
                ee.emit("WANStats", wanData);
            }
        });
}


function periodicCubePull() {
    setInterval(function () {
        getCubeSensorCurrentData()
    }, 60000);
}

function periodicWANRPull() {
    setInterval(function () {
        getWanStats()
    }, 5000);
}

getCubeSensorInfo();
periodicWANRPull();
periodicCubePull();


