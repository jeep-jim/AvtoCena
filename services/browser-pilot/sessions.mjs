export class SessionError extends Error {constructor(code,status=400){super(code);this.status=status;}}
export class Sessions {
 constructor({open,now=Date.now,max=2,leaseMs=20000,idleMs=90000,lifeMs=600000}={}) {
  Object.assign(this,{open,now,max,leaseMs,idleMs,lifeMs});this.rows=new Map();this.closed=new Map();this.starts=new Map();this.pending=new Set();this.permits=new Set();this.globalStarts=[];
 }
 create(owner,id,prompt) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw new SessionError('invalid_session');
  if(this.closed.has(owner+id))throw new SessionError('session_closed',410);
  const existing=this.rows.get(id);if(existing){if(existing.owner!==owner)throw new SessionError('session_not_found',404);return this.public(existing);}
  if([...this.rows.values()].some(s=>s.owner===owner))throw new SessionError('session_already_open',409);
  if(this.permits.size>=this.max)throw new SessionError('pilot_busy',429);
  const now=this.now(),recent=(this.starts.get(owner)||[]).filter(at=>now-at<3600000);
  if(recent.length>=12)throw new SessionError('session_rate_limit',429);
  this.globalStarts=this.globalStarts.filter(at=>now-at<3600000);if(this.globalStarts.length>=60)throw new SessionError('session_rate_limit',429);this.globalStarts.push(now);
  recent.push(now);this.starts.set(owner,recent);
  const s={id,owner,started:now,heartbeat:now,activity:now,state:'starting',busy:false,browser:null,frameAt:-Infinity};this.rows.set(id,s);this.permits.add(s);
  const task=(async()=>{try {
   const browser=await this.open();
   if(this.rows.get(id)!==s){await browser.close();this.permits.delete(s);return;}
   s.browser=browser;
   await browser.start(prompt);
   if(this.rows.get(id)===s)s.state='ready';
  }catch(e){if(this.rows.get(id)===s){s.state='failed';s.error=['provider_blocked','composer_missing','provider_unavailable'].includes(e.message)?e.message:'browser_start_failed';await s.browser?.close().catch(()=>{});s.browser=null;this.permits.delete(s);}else this.permits.delete(s);}})();
  this.pending.add(task);task.finally(()=>this.pending.delete(task));return this.public(s);
 }
 public(s){return {id:s.id,state:s.state,error:s.error,expiresAt:s.started+this.lifeMs};}
 get(owner,id){const s=this.rows.get(id);if(!s||s.owner!==owner)throw new SessionError('session_not_found',410);return s;}
 heartbeat(owner,id){const s=this.get(owner,id);s.heartbeat=this.now();return this.public(s);}
 async close(owner,id) {
  const s=this.rows.get(id);if(s&&s.owner!==owner)throw new SessionError('session_not_found',404);
  this.closed.set(owner+id,this.now());if(!s)return {closed:true};
  this.rows.delete(id);if(s.browser){await s.browser.close().catch(()=>{});s.browser=null;this.permits.delete(s);}else if(s.state!=='starting')this.permits.delete(s);return {closed:true};
 }
 async act(owner,id,action,payload={}) {
  const s=this.get(owner,id);if(s.state!=='ready'||!s.browser)throw new SessionError(s.error||'browser_starting',409);
  if(s.busy)throw new SessionError('browser_busy',409);s.busy=true;
  try {
   if(action==='frame') {
    if(this.now()-s.frameAt<1200)throw new SessionError('frame_rate_limit',429);
    s.frameAt=this.now();return await s.browser.frame();
   }
   s.activity=this.now();
   if(action==='send')await s.browser.send(payload.text);
   else if(action==='scroll')await s.browser.scroll(payload.delta);
   else throw new SessionError('invalid_action');
   return this.public(s);
  }catch(e){if(e.message==='provider_blocked'){await this.close(owner,id);throw new SessionError('provider_blocked',403);}throw e;}
  finally{s.busy=false;}
 }
 async sweep(){const now=this.now();await Promise.all([...this.rows.values()].filter(s=>now-s.heartbeat>=this.leaseMs||now-s.activity>=this.idleMs||now-s.started>=this.lifeMs).map(s=>this.close(s.owner,s.id)));for(const [key,at] of this.closed)if(now-at>120000)this.closed.delete(key);for(const [key,times] of this.starts)if(times.every(at=>now-at>3600000))this.starts.delete(key);}
 async shutdown(){await Promise.all([...this.rows.values()].map(s=>this.close(s.owner,s.id)));await Promise.allSettled([...this.pending]);}
}
