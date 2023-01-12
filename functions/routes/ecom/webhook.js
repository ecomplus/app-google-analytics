// read configured E-Com Plus app data
const getAppData = require('./../../lib/store-api/get-app-data')

const axios = require('axios')

const Axios = axios.create({
  baseURL: 'https://www.google-analytics.com',
  headers: {
    'Content-Type': 'application/json'
  }
})

const SKIP_TRIGGER_NAME = 'SkipTrigger'
const ECHO_SUCCESS = 'SUCCESS'
const ECHO_SKIP = 'SKIP'
const ECHO_API_ERROR = 'STORE_API_ERR'

const findOrderById = (appSdk, storeId, orderId, auth) => new Promise((resolve, reject) => {
  appSdk.apiRequest(storeId, `/orders/${orderId}.json`, 'GET', null, auth)
    .then(({ response }) => {
      resolve(response.data)
    })
    .catch(err => {
      reject(err)
    })
})

exports.post = async ({ appSdk, admin }, req, res) => {
  // receiving notification from Store API
  const { storeId } = req

  /**
   * Treat E-Com Plus trigger body here
   * Ref.: https://developers.e-com.plus/docs/api/#/store/triggers/
   */
  const trigger = req.body
  // console.log('>>body: ', JSON.stringify(trigger), ' <<')

  if (trigger.resource === 'orders') {
    const orderId = trigger.inserted_id || trigger.resource_id
    let order = trigger.body

    try {
      const auth = await appSdk.getAuth(storeId)
      order = await findOrderById(appSdk, storeId, orderId, auth)
      // console.log('>> Webhooh Order: ', order)
      const buyer = order.buyers && order.buyers[0]
      if (orderId && order.items) {
        // get app configured options

        const appData = await getAppData({ appSdk, storeId, auth })
        if (
          Array.isArray(appData.ignore_triggers) &&
          appData.ignore_triggers.indexOf(trigger.resource) > -1
        ) {
          // ignore current trigger
          const err = new Error()
          err.name = SKIP_TRIGGER_NAME
          throw err
        }

        const measurementId = appData.measurement_id
        const apiSecret = appData.api_secret
        const enabledCustonEvent = order.financial_status?.current && appData.custom_events
        const enabledRefundEvent = order.status === 'cancelled' && appData.refund_event !== false

        console.log('>> Store: ', storeId, ' status: ', order.status, ' financial Status: ',
          order.financial_status.current, ' enable Custon: ', enabledCustonEvent,
          ' Event Cancelled', enabledRefundEvent)

        if (measurementId && apiSecret && (enabledCustonEvent || enabledRefundEvent)) {
          const url = `/mp/collect?api_secret=${apiSecret}&measurement_id=${measurementId}`

          const items = order.items.map(item => {
            const eventItem = {
              item_id: item.product_id || item.sku,
              item_name: item.name,
              price: item.final_price || item.price,
              quantity: item.quantity || 1
            }
            if (item.variation_id) {
              eventItem.item_variant = item.variation_id
            }

            if (order.extra_discount?.discount_coupon) {
              eventItem.coupon = order.extra_discount.discount_coupon
            }
            return eventItem
          })

          const params = {
            id: orderId,
            currency: order.currency_id || 'BRL',
            transaction_id: orderId,
            value: order.amount.total,
            status: order.financial_status?.current || order.status,
            items
          }
          if (order.amount.freight) {
            params.shipping = order.amount.freight
          }
          if (order.amount.tax || order.amount.extra) {
            params.tax = (order.amount.tax || 0) + (order.amount.extra || 0)
          }
          if (order.utm?.campaign) {
            params.coupon = order.utm.campaign
          }

          const events = []

          const docRef = admin.firestore().doc(`events_sent/${orderId}`)
          const lastSentEvents = (await docRef.get()).get('eventNames') || []

          if (enabledCustonEvent && order.financial_status) {
            const eventName = `purchase_${order.financial_status.current}`
            if (!lastSentEvents.includes(eventName)) {
              events.push({ name: eventName, params })
            }
          }

          if (enabledRefundEvent && !lastSentEvents.includes('refund')) {
            events.push({ name: 'refund', params })
          }
          // https://developers.google.com/analytics/devguides/collection/ga4/reference/events?client_type=gtag#purchase

          if (events.length) {
            const body = {
              client_id: buyer?._id || Date.now().toString(),
              events
            }

            console.log('>> url: ', url, ' body: ', JSON.stringify(body))
            await Axios.post(url, body)

            await docRef.set({
              storeId,
              eventNames: events.map(({ name }) => name),
              updatedAt: admin.firestore.Timestamp.now()
            }, { merge: true })
              .catch(console.error)

            return res.send(ECHO_SUCCESS)
          }

          return res.send(ECHO_SKIP)
        } else {
          console.log('>> measurementId or apiSecret not found, or disabled event')
          return res.status(400).send(ECHO_SKIP)
        }
      }
    } catch (err) {
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
        console.error(err)
        // request to Store API with error response
        // return error status code
        res.status(500)
        const { message } = err
        res.send({
          error: ECHO_API_ERROR,
          message
        })
      }
      return null
    }
  }
  return res.sendStatus(412)
}
