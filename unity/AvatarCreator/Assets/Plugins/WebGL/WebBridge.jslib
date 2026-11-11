mergeInto(LibraryManager.library, {
  TM_GetInitialSpec: function () {
    var initial = window.TablemateAvatar && window.TablemateAvatar.initial;
    return stringToNewUTF8(initial ? JSON.stringify(initial) : '');
  },
  TM_SaveSpec: function (pointer) {
    var json = UTF8ToString(pointer);
    var notify = function (message) {
      if (window.tablemateUnityInstance) window.tablemateUnityInstance.SendMessage('AvatarBridge', 'OnSaveResult', message);
    };
    if (!window.TablemateAvatar || !window.TablemateAvatar.save) { notify('error:Creator bridge unavailable.'); return; }
    window.TablemateAvatar.save(json).then(function () { notify('ok'); }, function (error) {
      notify('error:' + (error && error.message ? error.message : 'Could not save character.'));
    });
  },
  TM_GetPrefersReducedMotion: function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
  },
  TM_Navigate: function (pointer) {
    var path = UTF8ToString(pointer);
    if (window.TablemateAvatar && window.TablemateAvatar.navigate) window.TablemateAvatar.navigate(path);
  }
});
