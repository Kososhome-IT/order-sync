/**
* @NApiVersion 2.1
* @NScriptType UserEventScript
* @name CH Charge Payment On Shopify
*
*/

define(['N/record', 'N/https', 'N/search', 'N/log'], (record, https, search, log) => {

    const afterSubmit = (context) => {

        try {
            const soId = context.newRecord.id;
            const salesOrder = record.load({
                type: record.Type.SALES_ORDER,
                id: soId
            });
            const oldRecord = context.oldRecord;
            // const oldSO = record.load({
            //     type: record.Type.SALES_ORDER,
            //     id: context.oldRecord.id
            // });
            let oldWmsOrderTypeValue = oldRecord.getValue('custbody_wmsse_ordertype');
            log.debug('oldWmsOrderTypeValue', oldWmsOrderTypeValue);
            let originalSo = salesOrder.getValue('custbody_ch_split_orders');
            originalSo = Number(originalSo[0]);
            log.debug('originalSo', originalSo);
            let newWmsOrderType = salesOrder.getText('custbody_wmsse_ordertype');
            log.debug('newWmsOrderType', newWmsOrderType);
            let newWmsOrderTypeValue = salesOrder.getValue('custbody_wmsse_ordertype');
            log.debug('newWmsOrderTypeValue', newWmsOrderTypeValue);
            let terms = salesOrder.getText('terms');
            log.debug('terms', terms);
            let orderSorce = salesOrder.getValue('custbody_ch_om_web_order_number');
            log.debug('orderSorce', orderSorce);
            let orderStatus = salesOrder.getText('status');
            log.debug('orderStatus', orderStatus);
            let depAmtToChargeOnShopify = salesOrder.getText('custbody_ch_deposit_amount_charge_shop');
            log.debug('depAmtToChargeOnShopify', depAmtToChargeOnShopify);
            const soLineCount = salesOrder.getLineCount({ sublistId: 'item' });
            const classes = [];
            for (let i = 0; i < soLineCount; i++) {
                let itemtype = salesOrder.getSublistValue('item', 'itemtype', i);
                //log.debug('itemtype', itemtype);

                if (itemtype == "InvtPart" || itemtype == "Kit") {

                    const class_ = salesOrder.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'class',
                        line: i
                    });

                    if (class_) {
                        classes.push(class_);
                    }
                }
            }

            log.debug('classes', classes);
            const isAllClassSame = checkUsingFilter(classes);
            log.debug('isAllClassSame', isAllClassSame);
            let shopifyOrderName;
            if (originalSo != null || originalSo != '') {

                if (isAllClassSame === true && (classes[0] === "12" || classes[0] === "219")) {
                    const originalSoRec = record.load({
                        type: record.Type.SALES_ORDER,
                        id: originalSo
                    });
                    const originalSoWebOrdernumber = originalSoRec.getValue('custbody_ch_om_web_order_number');
                    log.debug('originalSoWebOrdernumber', originalSoWebOrdernumber);
                    shopifyOrderName = originalSoWebOrdernumber;
                    log.debug('70');
                } else {
                    shopifyOrderName = orderSorce;
                    log.debug('73');
                }

            }

            if (context.type === context.UserEventType.EDIT && newWmsOrderTypeValue !== oldWmsOrderTypeValue && newWmsOrderType === 'Shopify Ready To Charge' && terms === 'Credit Card') {
                const paymentCapture = {
                    "shopifyOrderName": shopifyOrderName,
                    "amount": depAmtToChargeOnShopify,
                    "custbody_wmsse_ordertype": newWmsOrderType,
                    "transactionType": orderStatus,
                    "netsuiteSalesOrderId": soId
                }
                log.debug('paymentCapture', paymentCapture);

                const paymentUrl = "https://order-sync-netsuite-549109569495.europe-west1.run.app/netsuite/capture-payment";
                const staginpaymentUrl = 'https://broken-nursery-fighter-same.trycloudflare.com/netsuite/capture-payment'

                const capturePayment = (payload, url) => {
                    try {
                        const response = https.post({
                            url: url,
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload)
                        });

                        log.debug({
                            title: 'Capture Payment Response',
                            details: {
                                code: response.code,
                                body: response.body
                            }
                        });

                        return response;
                    } catch (error) {
                        log.error('capturePayment Error', error);
                        throw error;
                    }
                };
                capturePayment(paymentCapture, paymentUrl);

            }
            function checkUsingFilter(classes) {
                return classes.every(val => val === classes[0]);
            }

        } catch (error) {
            log.error('error', error);
        }
    };

    return {
        afterSubmit
    };
});