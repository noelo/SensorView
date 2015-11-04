oc new-project dev2sensor

oc new-app  https://github.com/noelo/SensorView  -e dbhost=192.168.1.161 -e dbport= -e dbusername= -e dbpassword= -e oauth_consumer_key= -e oauth_consumer_secret= -e oauth_token= -e oauth_secret=

oc get pods

oc logs sensorview-1-build

oc start-build --from=sensorview-2

oc start-build --from=sensorview-2-build --follow

oc start-build --from-build=sensorview-2-build --follow

oc get is --namespace dev2sensor

oc describe is sensorview

oc tag sensorview@sha256:c011c86e1b8c0be8891e518c43962879980f843114d33f62525026e84d4207bc sensorview:prodready