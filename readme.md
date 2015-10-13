oc new-project dev2sensor

oc new-app  https://github.com/noelo/SensorView  -e dbhost=192.168.1.161 -e dbport= -e dbusername= -e dbpassword= -e oauth_consumer_key= -e oauth_consumer_secret= -e oauth_token= -e oauth_secret=
oc get pods
oc logs sensorview-1-build
oc start-build --from=sensorview-2
oc start-build --from=sensorview-2-build --follow
oc start-build --from-build=sensorview-2-build --follow