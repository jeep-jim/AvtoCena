import test from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE} from '../.github/operations/ajes-japan-only-20261124/release-contract.mjs';
import {verifiedBuilder,checkedImage,RESOURCE_FILES} from '../.github/operations/ajes-japan-only-20261124/release-image.mjs';

const imageId='sha256:'+'a'.repeat(64);
const hostStore={ServerVersion:'29.1.3',Driver:'overlayfs',DriverStatus:[['driver-type','io.containerd.snapshotter.v1']]};
function exportedImage(){
  return {
    inspection:{Id:imageId,Descriptor:{digest:imageId},Os:'linux',Architecture:'amd64',Size:1024,
      Config:{WorkingDir:'/app',Cmd:['node','apps/web/server.js'],Labels:{
        'org.opencontainers.image.revision':PROFILE.source,
        'org.opencontainers.image.source':'https://github.com/jeep-jim/AvtoCena','avtocena.application':'web'}}},
    probeLog:[{stage:'home_image_probe',passed:true,nodeVersion:'v24.22.1',privateIndexInImage:false,
      modelAssetSha256:'ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662'},
      {stage:'node_resource_memory',nodeVersion:'v24.22.1',actualHeapBytes:1048576,requestedHeapBytes:1048576,
        availableRamBytes:1048576,usableSwapBytes:0}].map(JSON.stringify).join('\n'),
    sourceProof:{source:PROFILE.source,tree:PROFILE.tree,codeDiffSha256:PROFILE.codeDiffSha256},
    archiveSha256:'b'.repeat(64),archiveBytes:2048,controllerSha:'c'.repeat(40),
    resourceFiles:Object.fromEntries(Object.keys(RESOURCE_FILES).map(name=>[name,'d'.repeat(64)])),
    builder:verifiedBuilder(hostStore),roundTripImageId:imageId,
  };
}

test('builder requires the observed containerd store instead of the runner classic store',()=>{
  assert.deepEqual(verifiedBuilder(hostStore),{version:'29.1.3',driver:'overlayfs',driverType:'io.containerd.snapshotter.v1'});
  for(const change of [{Driver:'overlay2'},{DriverStatus:[]},{ServerVersion:'28.0.0'},{DriverStatus:[['driver-type','unknown']]}])
    assert.throws(()=>verifiedBuilder({...hostStore,...change}),/image_builder_store/);
});

test('archive receipt requires a successful round trip with the same manifest identity',()=>{
  const receipt=checkedImage(exportedImage());
  assert.equal(receipt.imageId,imageId);
  assert.equal(receipt.archiveRoundTripVerified,true);
  assert.equal(receipt.builder.driverType,'io.containerd.snapshotter.v1');
  for(const roundTripImageId of [undefined,'sha256:'+'e'.repeat(64)])
    assert.throws(()=>checkedImage({...exportedImage(),roundTripImageId}),/image_portable_identity/);
});

test('labels and successful application probes cannot authorize an unverified image identity',()=>{
  for(const descriptor of [undefined,{digest:'sha256:'+'f'.repeat(64)}]){
    const value=exportedImage();value.inspection.Descriptor=descriptor;
    assert.throws(()=>checkedImage(value),/image_portable_identity/);
  }
  assert.throws(()=>checkedImage({...exportedImage(),builder:{version:'29.1.3',driver:'overlay2'}}),/image_portable_identity/);
});
