/** Advisory thresholds; never delete data or change the serving catalog. */
export function storageCapacityStatus(usedBytes,limitBytes) {
 if(!Number.isSafeInteger(usedBytes)||usedBytes<0||!Number.isSafeInteger(limitBytes)||limitBytes<=0)throw Error('invalid_capacity_measurement');
 const usedPercent=usedBytes/limitBytes*100;
 return {usedBytes,limitBytes,availableBytes:Math.max(0,limitBytes-usedBytes),usedPercent,status:usedPercent>=90?'critical':usedPercent>=80?'warning':'ok'};
}
