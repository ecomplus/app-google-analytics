// read configured E-Com Plus app data
const { default: axios } = require('axios')
const getAppData = require('./../../lib/store-api/get-app-data')

const Axios = require(axios)

const createAxios = () => {
  const headers = {
    'Content- Type': application / json
  }

  return axios.create({
    baseURL: 'www.google-analytics.com',
    headers
  })
}

const SKIP_TRIGGER_NAME = 'SkipTrigger'
const ECHO_SUCCESS = 'SUCCESS'
const ECHO_SKIP = 'SKIP'
const ECHO_API_ERROR = 'STORE_API_ERR'

// const getAuth = (appSdk, storeId) => new Promise((resolve, reject) => {
//   appSdk.getAuth(storeId)
//     .then(auth => resolve(auth))
//     .catch(err => reject(err))
// })

// const findOrderById = (appSdk, storeId, orderId, auth) => new Promise((resolve, reject) => {
//   appSdk.apiRequest(storeId, `/orders/${orderId}.json`, 'GET', null, auth)
//     .then(({ response }) => {
//       resolve(response.data)
//     })
//     .catch(err => {
//       reject(err)
//     })
// })

exports.post = ({ appSdk, admin }, req, res) => {
  // receiving notification from Store API
  const { storeId } = req

  /**
   * Treat E-Com Plus trigger body here
   * Ref.: https://developers.e-com.plus/docs/api/#/store/triggers/
   */
  const trigger = req.body

  if (trigger.resource === 'orders' && trigger.action === 'create') {
    const orderId = trigger.inserted_id
    let order = trigger.body
    if (order.status === 'cancelled') {
      res.sendStatus(204)
      return
    }
    const buyer = order.buyers && order.buyers[0]
    const clientIp = order.browser_ip
    if (orderId && buyer && clientIp) {

      // get app configured options
      getAppData({ appSdk, storeId })

        .then(appData => {
          if (
            Array.isArray(appData.ignore_triggers) &&
            appData.ignore_triggers.indexOf(trigger.resource) > -1
          ) {
            // ignore current trigger
            const err = new Error()
            err.name = SKIP_TRIGGER_NAME
            throw err
          }

          const firebaseAppId = appData.firebase_app_id
          const apiSecret = appData.api_secret
          if (firebaseAppId && apiSecret) {
            // url = `/mp/collect?firebase_app_id=${firebaseAppId}&api_secret=${apiSecret}`
            // const axios = createAxios()
            // const intanceId = admin.instanceId()
            // const body = {
            //   app_instance_id: intanceId,
            //   events: [{
            //     name: 'tutorial_begin',
            //     params: {},
            //   }]
            // }
            // console.log('>>intanceId: ', intanceId)

          } else {
            console.log('>> firebaseAppId or apiSecret not found')
            res.status(400).send(ECHO_SKIP)
            return
          }

          // res.send(ECHO_SUCCESS)
        })

        .catch(err => {
          if (err.name === SKIP_TRIGGER_NAME) {
            // trigger ignored by app configuration
            res.send(ECHO_SKIP)
          } else if (err.appWithoutAuth === true) {
            const msg = `Webhook for ${storeId} unhandled with no authentication found`
            const error = new Error(msg)
            error.trigger = JSON.stringify(trigger)
            console.error(error)
            res.status(412).send(msg)
          } else {
            // console.error(err)
            // request to Store API with error response
            // return error status code
            res.status(500)
            const { message } = err
            res.send({
              error: ECHO_API_ERROR,
              message
            })
          }
        })
    }
  }
  res.sendStatus(412)
}
