import test from 'node:test';
import assert from 'node:assert/strict';
import {dubicarsNextCursor} from '../apps/web/lib/catalog/dubicars-current-source';
test('DubiCars follows declared next page and recognizes terminal navigation',()=>{
 assert.equal(dubicarsNextCursor('<link rel="next" href="https://www.dubicars.com/uae/used?page=2"><a href="?page=2" rel="next">Next</a>',1),'2');
 assert.equal(dubicarsNextCursor('<nav id="pagination"><a rel="prev" href="?page=331">Previous</a><a rel="next" href="" class="disabled">Next</a></nav>',332),null);
});
test('missing, conflicting and backward pagination cannot claim completion',()=>{
 for(const html of ['<html>changed layout</html>','<a rel="next" href="?page=1">Next</a>','<a rel="next" href="https://other.example/?page=2">Next</a>','<a rel="next" href="?page=2">Next</a><a rel="next" href="?page=3">Next</a>'])assert.throws(()=>dubicarsNextCursor(html,1));
});
