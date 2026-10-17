import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pipeline} from 'node:stream/promises';

export async function consumeChe168Csv({chunks,yearFrom,onRow}) {
  const child=spawn('python3',['scripts/che168-csv.py',String(yearFrom)],{stdio:['pipe','pipe','pipe']});
  child.stderr.resume();
  const exited=new Promise(resolve=>{child.on('error',()=>resolve(-1));child.on('close',resolve);});
  let inputError;
  const input=pipeline(chunks,child.stdin).catch(error=>{inputError=error;child.kill();});
  let complete=null,count=0;
  try {
    for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})) {
      let row;try{row=JSON.parse(line);}catch{throw Error('auto_api_invalid_csv_output');}
      if(row.csvComplete){if(complete)throw Error('auto_api_invalid_csv_output');complete=row;}
      else {if(complete)throw Error('auto_api_invalid_csv_output');await onRow(row);count++;}
    }
    await input;
    if(inputError||await exited!==0||!complete||complete.selectedRows!==count)throw Error('auto_api_invalid_csv');
    return complete;
  }finally{child.kill();await input;await exited;}
}
