/*globals app, console, R, Backbone, Firebase, rdioUserKey, firebaseToken, firebaseRootUrl, firebaseRef */

window.app = window.app || {};

app.currentUserKey = rdioUserKey;

app.roomUrl = firebaseRootUrl;

app.Player = Backbone.Firebase.Model.extend({

  firebase: app.roomUrl + '/player'

});

app.PlaylistView = Backbone.View.extend({
  el: '.playlist',
  template: _.template($('#playlist-template').html()),

  events: {
    "click .playlist_text": "onPlaylistClick"
  },
  initialize: function() {
    this.snapped = false
    this.render()
  },
  render: function() {
    values = {
      'snapped': this.snapped,
      'playlist': this.playlist
    }
    this.$el.html(this.template(values));
    return this
  },
  getDateString: function() {
    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth()+1;
    var yyyy = today.getFullYear();
    if(dd<10) {
        dd='0'+dd
    }
    if(mm<10) {
        mm='0'+mm
    }
    today = yyyy + '-' + mm + '-' + dd
    return today
  },
  getRoomString: function() {
    var roomUrlList = app.roomUrl.split('/')
    var roomString = roomUrlList[roomUrlList.length-1].replace(/_/g, ' ')
    return roomString
  },

  onPlaylistClick: function() {
    var playlistName = 'Rdio Party "' + this.getRoomString() + '" ' + this.getDateString()
    this.trackIds = chat.messageHistory.map(function(x) { if (x.attributes.type == 'NewTrack') { return x.attributes.trackKey }; });
    R.request({
      method: 'createPlaylist',
      content: {
        name: playlistName,
        description: 'lovingly created from rdioparty!',
        tracks: this.trackIds
      },
      success: function(response) {
        console.log('playlist created')
      },
      error: function(response) {
        console.log('playlist probably not created');
      }
    });
    this.snapped = true
    this.playlist = playlistName
    this.render()
  }
})

app.Track = Backbone.Model.extend({
  LIKE: 'like',
  DISLIKE: 'dislike',

  getVoteRef: function() {
    return this.collection.firebase.child(this.get('id')).child('votes');
  },

  vote: function(newVote) {
    console.info('Voting', newVote, 'for', this.get('trackKey'));
    this.getVoteRef().child(app.currentUserKey).set(newVote);
  },

  upVote: function() {
    this.vote(this.LIKE);
  },

  downVote: function() {
    this.vote(this.DISLIKE);
  },

  getVoteCount: function(voteType) {
    var voteArray = this.get('votes');
    if (voteArray === undefined) {
      return 0;
    }
    var votes = _.values(voteArray);
    var count = _.reduce(votes, function(num, vote) {
      if (vote === voteType) {
        return num + 1;
      } else {
        return num;
      }
    }, 0);
    return count;
  },

  getVoteCounts: function() {
    var likeCount = this.getVoteCount(this.LIKE);
    var dislikeCount = this.getVoteCount(this.DISLIKE);

    return {
      upVotes: likeCount,
      downVotes: dislikeCount,
      totalVotes: likeCount - dislikeCount
    };
  },

  getDuration: function(duration) {
    var durationInSecs = duration;
    var durationMins = Math.floor(duration / 60);
    var durationSecs = String(duration % 60);
    if (durationSecs.length < 2)
      durationSecs = "0" + durationSecs;
    return durationMins + ":" + durationSecs;
  },

});


app.TrackList = Backbone.Firebase.Collection.extend({
  model: app.Track,

  firebase: app.roomUrl + '/queue',

  comparator: function(a, b) {
    var aScore = a.getVoteCounts().totalVotes;
    var bScore = b.getVoteCounts().totalVotes;
    return bScore - aScore;
  }

});

app.queue = new app.TrackList();

app.SkipList = Backbone.Firebase.Collection.extend({
  model: chat.User,
  firebase: app.roomUrl + '/skippers',

  voteToSkip: function() {
    if (!this.contains(chat.currentUser)) {
      this.add(chat.currentUser);
      chat.sendMessage("Voted to skip");
    }
  },

  //HACK TODO there has got to be a better way to do this
  clear: function() {
    while (this.length > 0) {
      this.pop();
    }
  }
});

app.skipList = new app.SkipList();

app.NowPlayingView = Backbone.View.extend({
  model: app.Track,

  el: '#now-playing',

  template: _.template($('#now-playing-template').html()),

  events: {
    'click #skip-button': '_clickSkip',
    'click #favorite-button': '_clickFavorites'
  },

  initialize: function() {
    var self = this;
    this.rdioTrackKey = null;
    this.activeUsers = chat.activeUsers;
    this.playState = app.playState;

    R.player.on('change:playingTrack', this._onPlayingTrackChange, this);
  },

  _clickSkip: function() {
    app.skipList.voteToSkip();
  },

  _clickFavorites: function() {
    this.favoriteCurrentlyPlaying();
  },

  /**
   * Handles changes to the currently playing track
   */
  _onPlayingTrackChange: function(newValue) {
    if (newValue === null) {
      this.rdioTrackKey = null;
    } else {
      this.rdioTrackKey = newValue.get('key');
    }

    this.render();
  },

  render: function() {
    var self = this;
    var keys = [this.rdioTrackKey];
    var userKey = null;
    if (self.playState.get('playingTrack')) {
      keys.push(self.playState.get('playingTrack').userKey);
      userKey = self.playState.get('playingTrack').userKey;
    }
    if (this.rdioTrackKey) {
      R.request({
        method: 'get',
        content: {
          keys: keys.join(","),
          extras: 'streamRegions,shortUrl,bigIcon,duration,dominantColor,playerBackgroundUrl'
        },
        success: function(response) {
          var userObj = (response.result[userKey]) ? response.result[userKey] : {firstName: '', lastName: ''};
          var addedByName = userObj.firstName + " " + userObj.lastName;
          var activeUsers = self.activeUsers;
          var masterUserObj = self.activeUsers.where({id:self.playState.get('masterUserKey')});
          var userName = null;
          if (masterUserObj.length > 0 && masterUserObj[0]) {
            userName = masterUserObj[0].get('fullName');
          }
          var data = _.extend({
            'track': response.result[self.rdioTrackKey],
            'masterUser': userName,
            'addedBy': addedByName
          });
          self.$el.html(self.template(data));
          self.$el.show();
          $('#wrap').css('background-image', 'url('+response.result[self.rdioTrackKey].playerBackgroundUrl+')');
        },
        error: function(response) {
          console.log('Unable to get tack information for', self.rdioTrackKey);
        }
      });

    } else {
      this.$el.hide();
    }
    return this;
  },

  favoriteCurrentlyPlaying: function() {
    R.request({
      method: 'addToFavorites',
      content: {
        keys: this.rdioTrackKey
      },
      success: function(response) {
        chat.sendMessage("favorited this track");
      }
    })
  },

  /**
   * Called when the client should listen to a remote player
   **/
  initSlaveStatus: function() {
    console.info('Becoming slave');

    if (app.playState.get('playState') == R.player.PLAYSTATE_PLAYING && app.playState.get('playingTrack')) {
      R.player.play({
        source: app.playState.get('playingTrack').trackKey,
        initialPosition: app.playState.get('position')
      });
    }

    app.playState.on('change:playingTrack', this._onSlaveTrackChange, this);
    app.playState.on('change:playState', this._onSlavePlayerStateChange, this);
  },

  _onSlaveTrackChange: function(model, value, options) {
    console.log('change:playingTrack', model, value, options);
    R.player.play({
      source: value.trackKey,
      initialPosition: model.get('position')
    });
  },

  _onSlavePlayerStateChange: function(model, value, options) {
    console.log('change:playState', model, value, options);
    switch (value) {
      case R.player.PLAYSTATE_PAUSED:
      case R.player.PLAYSTATE_STOPPED:
        R.player.pause();
        break;
      case R.player.PLAYSTATE_PLAYING:
        R.player.play();
        break;
    }
  }

});

app.TrackView = Backbone.View.extend({
  tagName: 'li',

  template: _.template($('#track-template').html()),

  events: {
    'click .up-vote': 'upVote',
    'click .down-vote': 'downVote'
  },

  initialize: function() {
    this.listenTo(this.model, 'change', this.render);
    this.listenTo(this.model, 'remove', this.remove);
    this.rdioTrack = null;
    this.rdioUser = null;

    var self = this;
    R.request({
      method: 'get',
      content: {
        keys: self.model.get('trackKey') + ',' + self.model.get('userKey'),
        extras: 'streamRegions,shortUrl,bigIcon,duration'
      },
      success: function(response) {
        self.rdioTrack = response.result[self.model.get('trackKey')];
        self.rdioUser = response.result[self.model.get('userKey')];
        self.trackDuration = self.getDuration(self.rdioTrack['duration']);
        self.render();
      },
      error: function(response) {
        console.log('Unable to get tack information for', self.model.get('trackKey'));
      }
    });

  },

  render: function() {
    if (this.rdioTrack && this.rdioUser) {
      var data = _.extend({
        'track': this.rdioTrack,
        'user': this.rdioUser,
        'formattedDuration': this.trackDuration,
      }, this.model.toJSON(), this.model.getVoteCounts());
      this.$el.html(this.template(data));
      this.$el.show();
    } else {
      this.$el.hide();
    }
    return this;
  },

  getDuration: function(duration) {
    var durationInSecs = duration;
    var durationMins = Math.floor(duration / 60);
    var durationSecs = String(duration % 60);
    if (durationSecs.length < 2)
      durationSecs = "0" + durationSecs;
    return durationMins + ":" + durationSecs;
  },

  upVote: function() {
    this.model.upVote();
    app.queue.sort();
  },

  downVote: function() {
    this.model.downVote();
    app.queue.sort();
  }

});

app.queueView = Backbone.View.extend({
  el: '#queue',

  statsTemplate: _.template($('#stats-template').html()),

  initialize: function() {
    this.queueStats = $('#queue-stats');

    this.listenTo(app.queue, 'add', this.addOne);
    this.listenTo(app.queue, 'sort', this.addAll);
    this.listenTo(app.queue, 'change', this.sortQueue);
    this.listenTo(app.queue, 'all', this.render);
    this.addAll(app.queue, {});
  },

  render: function() {
    if (app.queue.length) {
      // this.queueStats.html(this.statsTemplate({queueSize: app.queue.length}));
      this.queueStats.show();
    } else {
      this.queueStats.hide();
    }
  },

  addOne: function (model, collection, options) {
    var view = new app.TrackView({ model: model });
    this.$el.append(view.render().el);
  },

  addAll: function (collection, options) {
    this.$el.empty();
    collection.each(this.addOne, this);
  },

  sortQueue: function() {
    app.queue.sort();
  }
});

app.ThemeInfo = Backbone.Firebase.Model.extend({
  firebase: app.roomUrl + '/meta',
  getText: function() { return this.get('themeText') },
  setText: function(text) { this.set({'themeText': text}) },

}),

app.ThemeView = Backbone.View.extend({
  el: '#theme',

  template: _.template($('#theme-template').html()),

  events: {
    "click .theme_name": "onThemeClick",
    "keyup .theme_text": "onThemeTextSubmit"
  },

  initialize: function() {
    this.editing = false
    this.model.setText('Play whatever your heart desires')
    this.listenTo(this.model, "change", this.render)
    this.render()
  },

  render: function() {
    var values = {
        'editing': this.editing,
        'themeText': this.model.getText()
    }
    this.$el.html(this.template(values));
    $(".theme_text").focus()
    return this;
  },

  onThemeTextSubmit: function(e) {
    if (e.keyCode == 13 && $(".theme_text").val()) {
      this.model.setText($(".theme_text").val())
      this.editing = false
      this.render()
    }
  },
  onThemeClick: function() {
    this.editing = true;
    this.render();
  }
})

R.ready(function() {
  firebaseRef.auth(firebaseToken, function(error) {
    if (error) {
      console.log('Login Failed!', error);
    } else {
      console.log('Login Succeeded!');

      app.playState = new app.Player();
      var queueView = new app.queueView();
      app.nowPlayingView = new app.NowPlayingView();
      var searchView = new app.SearchView();
      var playlistView = new app.PlaylistView();
      var themeView = new app.ThemeView({model: new app.ThemeInfo()});
      app.nowPlayingView.initSlaveStatus();
    }
  });
});
