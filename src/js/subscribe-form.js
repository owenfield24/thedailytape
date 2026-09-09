// Wires up the "Get sector briefs in your inbox" form rendered on every page
// (renderSubscribeForm() in templates/partials.js). Posts to /api/subscribe
// (api/subscribe.js), which forwards the email + chosen pods to Buttondown
// as subscriber tags. Site-root-absolute fetch path since this script runs
// at every page depth, same reasoning as watchlist-quotes.js.

(function () {
  var form = document.getElementById('subscribe-form');
  if (!form) return;

  var status = document.getElementById('subscribe-status');
  var submitButton = form.querySelector('button[type="submit"]');

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('subscribe-status-error', !!isError);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var email = form.querySelector('input[name="email"]').value.trim();
    var pods = Array.prototype.slice
      .call(form.querySelectorAll('input[name="pods"]:checked'))
      .map(function (checkbox) {
        return checkbox.value;
      });

    if (!email) {
      setStatus('Enter an email address.', true);
      return;
    }
    if (!pods.length) {
      setStatus('Pick at least one pod.', true);
      return;
    }

    submitButton.disabled = true;
    setStatus('Subscribing…', false);

    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, pods: pods }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data.ok) throw new Error((data && data.error) || 'Subscription failed');
          return data;
        });
      })
      .then(function () {
        setStatus('Check your inbox to confirm your subscription.', false);
        form.reset();
      })
      .catch(function (err) {
        setStatus(err.message || 'Something went wrong. Try again later.', true);
      })
      .finally(function () {
        submitButton.disabled = false;
      });
  });
})();
