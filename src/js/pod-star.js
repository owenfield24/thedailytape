// Personal "pin to my homepage" star. There's no login or database on this
// site, so this is a per-browser preference stored in localStorage — it
// changes what YOU see when you load the homepage, not the published order
// pod leads control via `pinned: true` in their own content file (see
// computeNavOrder() in scripts/build.js). Runs on every page: on a pod page
// it wires up the star button next to the pod name; on the homepage it
// reorders the pod grid to match your stars.

(function () {
  var STORAGE_KEY = 'dailyTapeStarredPods';

  function getStarred() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function setStarred(slugs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs));
    } catch (e) {
      // Private browsing / storage disabled — the star just won't persist.
    }
  }

  function updateButton(button, isStarred) {
    button.setAttribute('aria-pressed', isStarred ? 'true' : 'false');
    var icon = button.querySelector('.star-icon');
    var label = button.querySelector('.star-label');
    if (icon) icon.innerHTML = isStarred ? '&#9733;' : '&#9734;';
    if (label) label.textContent = isStarred ? 'Pinned to your homepage' : 'Pin to your homepage';
  }

  var toggleButton = document.getElementById('star-toggle');
  if (toggleButton) {
    var slug = toggleButton.getAttribute('data-slug');
    updateButton(toggleButton, getStarred().indexOf(slug) !== -1);

    toggleButton.addEventListener('click', function () {
      var starred = getStarred();
      var index = starred.indexOf(slug);
      if (index === -1) {
        starred.unshift(slug);
      } else {
        starred.splice(index, 1);
      }
      setStarred(starred);
      updateButton(toggleButton, starred.indexOf(slug) !== -1);
    });
  }

  var grid = document.getElementById('pods-grid');
  if (grid) {
    var starredSlugs = getStarred();
    for (var i = starredSlugs.length - 1; i >= 0; i--) {
      var card = grid.querySelector('[data-slug="' + starredSlugs[i] + '"]');
      if (card) {
        card.classList.add('pod-card-starred');
        grid.insertBefore(card, grid.firstChild);
      }
    }
  }
})();
