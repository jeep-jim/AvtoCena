import test from 'node:test';import assert from 'node:assert/strict';
import {autoScoutPublicWindowEnded} from '../apps/web/lib/catalog/autoscout-exact-source-base';
const props={pageid:'list',pageQuery:{page:'201'},numberOfPages:0,numberOfResults:0,listings:[]};
const html=(p:any)=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:p}})}</script>`;
test('explicit empty terminal source page ends the public result window',()=>{
 assert.equal(autoScoutPublicWindowEnded(html(props),201),true);
 for(const bad of [{...props,listings:[{id:'unparsed'}]},{...props,numberOfPages:null},{...props,pageid:'challenge'},{...props,pageQuery:{page:'1'}},{...props,numberOfResults:1}])assert.equal(autoScoutPublicWindowEnded(html(bad),201),false);
 assert.equal(autoScoutPublicWindowEnded(html({...props,pageQuery:{page:'1'}}),1),false);
 assert.equal(autoScoutPublicWindowEnded('<html>Access denied</html>',201),false);
});
