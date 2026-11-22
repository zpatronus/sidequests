let resetDialog;

function getResetDialog() {
  if(resetDialog)return resetDialog;
  resetDialog=document.createElement('dialog');
  resetDialog.className='reset-dialog';
  resetDialog.setAttribute('aria-labelledby','reset-dialog-title');
  resetDialog.setAttribute('aria-describedby','reset-dialog-field reset-dialog-values');
  resetDialog.innerHTML=`
    <form method="dialog">
      <h2 id="reset-dialog-title">重置为默认值</h2>
      <p id="reset-dialog-field"></p>
      <dl id="reset-dialog-values">
        <dt>当前值</dt><dd data-current></dd>
        <dt>默认值</dt><dd data-default></dd>
      </dl>
      <div class="dialog-actions">
        <button value="cancel" autofocus>取消</button>
        <button value="reset" class="primary">确认重置</button>
      </div>
    </form>`;
  document.body.append(resetDialog);
  return resetDialog;
}

export function confirmReset(field,current,next) {
  const dialog=getResetDialog();
  if(dialog.open)return Promise.resolve(false);
  dialog.querySelector('#reset-dialog-field').textContent=field;
  dialog.querySelector('[data-current]').textContent=current||'空白';
  dialog.querySelector('[data-default]').textContent=next;
  dialog.returnValue='';
  return new Promise(resolve=>{
    dialog.showModal();
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='reset'),{once:true});
  });
}

export function chooseImportMode(currentCount,incomingCount) {
  const dialog=document.getElementById('import-dialog');
  if(dialog.open)return Promise.resolve('');
  document.getElementById('import-description').textContent='备份包含 '+incomingCount+' 份 Offer，当前有 '+currentCount+' 份。';
  dialog.returnValue='';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true});
    dialog.showModal();
  });
}
