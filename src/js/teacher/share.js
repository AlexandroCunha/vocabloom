/* Teacher step 3: the link to give to students (the end of the flow). */

const LONG_LINK_CHARS = 6000;

function shareHtml() {
  return '<section class="panel"><h2>Share with your students</h2><p class="lead">Send them the link. It opens on any phone, no login needed.</p>'
    + '<div class="linkbox"><input type="text" id="lnk" readonly value="Preparing link..." aria-label="Link to share"><button id="cl">Copy</button></div>'
    + '<div class="note warn" id="long" hidden>This link is very long. WhatsApp and some apps may cut it. If that happens, use <b>Download</b> and send the file instead.</div>'
    + '<div class="btns"><button class="sec" id="dl">Download as a file</button><button class="ghost" id="op">Open student view</button></div>'
    + '<p class="lead" style="margin:0">Paste the link into Google Classroom, WhatsApp or anywhere else. Answers stay on each student\'s phone, so there is nothing for you to collect.</p>'
    + '<div class="phone"><div id="pv"></div></div>'
    + '<div class="nav"><button class="sec" id="b2">&larr; Edit</button><button class="sec" id="b1">New PDF</button></div></section>';
}

async function renderShareStep(session, nav) {
  const worksheet = session.worksheet;
  $('#stage').innerHTML = shareHtml();
  renderPlayer($('#pv'), worksheet, { persist: false });

  $('#b1').onclick = () => { session.worksheet = null; session.file = null; nav.go(1); };
  $('#b2').onclick = () => nav.go(2);
  $('#dl').onclick = () => { downloadTextFile(slug(worksheet.title) + '.html', buildStandalonePage(worksheet)); toast('Downloaded'); };

  let link = '';
  try {
    link = location.origin + location.pathname + '#' + await pack(worksheet);
    $('#lnk').value = link;
    $('#long').hidden = link.length < LONG_LINK_CHARS;
  } catch (error) {
    $('#lnk').value = 'Could not create a link. Use Download instead.';
  }
  $('#cl').onclick = () => { if (link) copyText(link, 'Copy the link'); };
  $('#op').onclick = () => { if (link) window.open(link, '_blank', 'noopener'); };
}
