/* The teacher app: three steps (upload, review, share) sharing one session. */

function startTeacher() {
  const session = { worksheet: null, file: null };
  const steps = [null, renderUploadStep, renderReviewStep, renderShareStep];

  $('#app').className = 'teacher';   // on a computer the teacher's tool uses a wider column than the student's page

  $('#app').innerHTML = '<div class="top"><div class="in">' + LOGO + '<div><h1>Vocabloom</h1><p>Turn any PDF worksheet into an interactive page</p></div></div></div>'
    + '<div class="steps" id="steps"><div><b>1</b>Upload</div><div><b>2</b>Review</div><div><b>3</b>Share</div></div><div class="wrap" id="stage"></div>';

  const nav = {
    go(step) {
      document.querySelectorAll('#steps div').forEach((tab, i) => {
        tab.className = (i + 1 === step) ? 'on' : (i + 1 < step ? 'done' : '');
      });
      steps[step](session, nav);
      window.scrollTo(0, 0);
    }
  };
  nav.go(1);
}
