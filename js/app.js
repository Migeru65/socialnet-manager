// js/app.js

// ================================================================
// Section 1: Supabase Client Initialization
// ================================================================
const { createClient } = supabase;

const SUPABASE_URL = 'https://nlcnqpmkyxtbbpveudrb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_MPRJvmgLxs2k9Q8hYdsNiQ_ip9PfbZ8';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ================================================================
// Section 2: Application State
// ================================================================
let currentProfileId = null;

// ================================================================
// Section 3: Helper Functions
// ================================================================

function setStatus(message, isError = false) {
  const bar = document.getElementById('status-message');
  const footer = document.getElementById('status-bar');
  bar.textContent = message;
  footer.style.background = isError ? '#6b1a1a' : 'var(--clr-status-bg)';
  footer.style.color = isError ? '#ffcccc' : 'var(--clr-status-text)';
}

function clearCentrePanel() {
  document.getElementById('profile-pic').src = 'resources/images/default.png';
  document.getElementById('profile-name').textContent = 'No Profile Selected';
  document.getElementById('profile-status').innerHTML = '&mdash;';
  document.getElementById('profile-quote').innerHTML = '&mdash;';
  document.getElementById('friends-list').innerHTML = '';
  currentProfileId = null;
}

function displayProfile(profile, friends =[]) {
  document.getElementById('profile-pic').src = profile.picture || 'resources/images/default.png';
  document.getElementById('profile-name').textContent = profile.name;
  document.getElementById('profile-status').textContent = profile.status || '(no status)';
  document.getElementById('profile-quote').textContent = profile.quote || '(no quote)';
  currentProfileId = profile.id;
  renderFriendsList(friends);
  setStatus(`Displaying ${profile.name}.`);
}

function renderFriendsList(friends) {
  const list = document.getElementById('friends-list');
  list.innerHTML = '';
  if (friends.length === 0) {
    list.innerHTML = '<div class="text-muted p-3 fst-italic">No friends yet.</div>';
    return;
  }
  friends.forEach(f => {
    const div = document.createElement('div');
    div.className = 'friend-entry';
    div.textContent = f.name; 
    list.appendChild(div);
  });
}

// Helper to translate HTTP status codes into readable messages
function diagnoseUploadStatus(status) {
  if (status === 413) return "File too large. Maximum limit is 10 MB.";
  if (status === 415) return "Unsupported file type.";
  if (status === 405) return "Method not allowed. Use POST.";
  if (status === 500) return "Server error during image compression.";
  return "Unknown upload error.";
}

// ================================================================
// Section 4: CRUD Functions
// ================================================================

async function loadProfileList() {
  try {
    const { data, error } = await db
      .from('profiles')
      .select('id, name, picture')
      .order('name', { ascending: true });

    if (error) throw error;

    const container = document.getElementById('profile-list');
    container.innerHTML = '';

    if (data.length === 0) {
      container.innerHTML = '<p class="text-muted small fst-italic p-3">No profiles found.</p>';
      return;
    }

    data.forEach(profile => {
      const row = document.createElement('div');
      row.className = 'profile-item';
      
      const img = document.createElement('img');
      img.className = 'list-thumb rounded-circle';
      img.src = profile.picture || 'resources/images/default.png';
      img.onerror = () => { img.src = 'resources/images/default.png'; }; 
      
      const span = document.createElement('span');
      span.textContent = profile.name;
      
      row.dataset.id = profile.id;
      row.appendChild(img);
      row.appendChild(span);
      
      row.addEventListener('click', () => selectProfile(profile.id));
      container.appendChild(row);
    });
  } catch (err) {
    setStatus(`Error loading profiles: ${err.message}`, true);
  }
}

async function selectProfile(profileId) {
  try {
    document.querySelectorAll('#profile-list .profile-item')
      .forEach(el => {
        el.classList.toggle('active', el.dataset.id === profileId);
      });

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single();

    if (profileError) throw profileError;

    const { data: friendsRels, error: friendsError } = await db
      .from('friends')
      .select('profile_id, friend_id')
      .or(`profile_id.eq.${profileId},friend_id.eq.${profileId}`);

    if (friendsError) throw friendsError;

    let friendsData =[];
    if (friendsRels.length > 0) {
      const friendIds = friendsRels.map(r => r.profile_id === profileId ? r.friend_id : r.profile_id);
      
      const { data: profilesData, error: profilesError } = await db
        .from('profiles')
        .select('name')
        .in('id', friendIds)
        .order('name', { ascending: true });
        
      if (profilesError) throw profilesError;
      friendsData = profilesData;
    }

    displayProfile(profile, friendsData);

  } catch (err) {
    setStatus(`Error selecting profile: ${err.message}`, true);
  }
}

async function addProfile() {
  const nameInput = document.getElementById('input-name');
  const name = nameInput.value.trim();

  if (!name) {
    setStatus('Error: Name field is empty. Please enter a name.', true);
    return;
  }

  try {
    const { data, error } = await db
      .from('profiles')
      .insert({ name })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        setStatus(`Error: A profile named "${name}" already exists.`, true);
      } else {
        throw error;
      }
      return;
    }

    nameInput.value = '';
    await loadProfileList();
    await selectProfile(data.id);
    setStatus(`Profile "${name}" created successfully.`);
  } catch (err) {
    setStatus(`Error adding profile: ${err.message}`, true);
  }
}

async function lookUpProfile() {
  const query = document.getElementById('input-name').value.trim();

  if (!query) {
    setStatus('Error: Search field is empty. Please enter a name to search.', true);
    return;
  }

  try {
    const { data, error } = await db
      .from('profiles')
      .select('id, name')
      .ilike('name', `%${query}%`)
      .order('name', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (data.length === 0) {
      setStatus(`No profile found matching "${query}".`, true);
      clearCentrePanel();
      return;
    }

    await selectProfile(data[0].id);
  } catch (err) {
    setStatus(`Error looking up profile: ${err.message}`, true);
  }
}

async function deleteProfile() {
  if (!currentProfileId) {
    setStatus('Error: No profile is selected. Click a profile in the list first.', true);
    return;
  }

  const name = document.getElementById('profile-name').textContent;

  if (!window.confirm(`Delete the profile for "${name}"? This cannot be undone.`)) {
    setStatus('Deletion cancelled.');
    return;
  }

  try {
    const { error } = await db
      .from('profiles')
      .delete()
      .eq('id', currentProfileId);

    if (error) throw error;

    clearCentrePanel();
    await loadProfileList();
    setStatus(`Profile "${name}" deleted. Friend relationships removed automatically.`);
  } catch (err) {
    setStatus(`Error deleting profile: ${err.message}`, true);
  }
}

async function changeStatus() {
  if (!currentProfileId) {
    setStatus('Error: No profile is selected.', true);
    return;
  }
  const newStatus = document.getElementById('input-status').value.trim();
  if (!newStatus) {
    setStatus('Error: Status field is empty.', true);
    return;
  }
  try {
    const { error } = await db
      .from('profiles')
      .update({ status: newStatus })
      .eq('id', currentProfileId);

    if (error) throw error;

    document.getElementById('profile-status').textContent = newStatus;
    document.getElementById('input-status').value = '';
    setStatus('Status updated.');
  } catch (err) {
    setStatus(`Error updating status: ${err.message}`, true);
  }
}

async function changeQuote() {
  if (!currentProfileId) {
    setStatus('Error: No profile is selected.', true);
    return;
  }
  const newQuote = document.getElementById('input-quote').value.trim();
  if (!newQuote) {
    setStatus('Error: Quote field is empty.', true);
    return;
  }
  try {
    const { error } = await db
      .from('profiles')
      .update({ quote: newQuote })
      .eq('id', currentProfileId);

    if (error) throw error;

    document.getElementById('profile-quote').textContent = newQuote;
    document.getElementById('input-quote').value = '';
    setStatus('Quote updated.');
  } catch (err) {
    setStatus(`Error updating quote: ${err.message}`, true);
  }
}

// Vercel Blob Upload & Direct URL Integration
async function changePicture() {
  if (!currentProfileId) {
    setStatus('Error: No profile is selected.', true);
    return;
  }
  
  const fileInput = document.getElementById('input-picture-file');
  const urlInput = document.getElementById('input-picture-url');
  
  const file = fileInput.files[0];
  const pastedUrl = urlInput.value.trim();
  
  if (!file && !pastedUrl) {
    setStatus('Error: Please select a file or paste a URL.', true);
    return;
  }

  let finalPictureUrl = "";
  const formData = new FormData();

  // Route both physical files and pasted URLs to the backend
  if (file) {
    setStatus('Uploading and compressing image...', false);
    formData.append("file", file);
  } else if (pastedUrl) {
    setStatus('Fetching and processing internet image...', false);
    formData.append("imageUrl", pastedUrl);
  }

  try {
    const response = await fetch("/api/upload-avatar", {
      method: "POST",
      body: formData, 
    });

    const rawText = await response.text();
    let result;
    
    try {
      result = JSON.parse(rawText);
    } catch {
      const preview = rawText.slice(0, 200).replace(/\s+/g, " ").trim();
      const hint = diagnoseUploadStatus(response.status);
      throw new Error(`HTTP ${response.status} (not JSON). ${hint} | Response: "${preview}"`);
    }

    if (!response.ok) {
      throw new Error(result.error || "Upload failed");
    }

    finalPictureUrl = result.url;

  } catch (uploadError) {
    setStatus(`Error processing picture: ${uploadError.message}`, true);
    return; 
  }

  try {
    const { error: dbError } = await db
      .from('profiles')
      .update({ picture: finalPictureUrl })
      .eq('id', currentProfileId);

    if (dbError) throw dbError;

    document.getElementById('profile-pic').src = finalPictureUrl;
    setStatus('Picture successfully updated!');
    await loadProfileList(); 

  } catch (dbError) {
    setStatus(`Error updating database: ${dbError.message}`, true);
  } finally {
    fileInput.value = ""; 
    urlInput.value = "";
  }
}

// ================================================================
// Section 5: Friends Management
// ================================================================

async function addFriend() {
  if (!currentProfileId) {
    setStatus('Error: No profile is selected.', true);
    return;
  }
  const friendName = document.getElementById('input-friend').value.trim();
  if (!friendName) {
    setStatus('Error: Friend name field is empty.', true);
    return;
  }
  try {
    const { data: found, error: findError } = await db
      .from('profiles')
      .select('id, name')
      .ilike('name', friendName)
      .limit(1);

    if (findError) throw findError;

    if (found.length === 0) {
      setStatus(`Error: No profile named "${friendName}" exists. Add that profile first.`, true);
      return;
    }

    const friendId = found[0].id;

    if (friendId === currentProfileId) {
      setStatus('Error: A profile cannot be friends with itself.', true);
      return;
    }

    const pId = currentProfileId < friendId ? currentProfileId : friendId;
    const fId = currentProfileId < friendId ? friendId : currentProfileId;

    const { error: insertError } = await db
      .from('friends')
      .insert({ profile_id: pId, friend_id: fId });

    if (insertError) {
      if (insertError.code === '23505') {
        setStatus(`"${friendName}" is already in the friends list.`, true);
      } else {
        throw insertError;
      }
      return;
    }

    document.getElementById('input-friend').value = '';
    await selectProfile(currentProfileId); 
    setStatus(`"${found[0].name}" added as a friend.`);
  } catch (err) {
    setStatus(`Error adding friend: ${err.message}`, true);
  }
}

async function removeFriend() {
  if (!currentProfileId) {
    setStatus('Error: No profile is selected.', true);
    return;
  }
  const friendName = document.getElementById('input-friend').value.trim();
  if (!friendName) {
    setStatus('Error: Friend name field is empty.', true);
    return;
  }
  try {
    const { data: found, error: findError } = await db
      .from('profiles')
      .select('id, name')
      .ilike('name', friendName)
      .limit(1);

    if (findError) throw findError;

    if (found.length === 0) {
      setStatus(`Error: No profile named "${friendName}" exists.`, true);
      return;
    }

    const friendId = found[0].id;

    const pId = currentProfileId < friendId ? currentProfileId : friendId;
    const fId = currentProfileId < friendId ? friendId : currentProfileId;

    const { error: deleteError } = await db
      .from('friends')
      .delete()
      .eq('profile_id', pId)
      .eq('friend_id', fId);

    if (deleteError) throw deleteError;

    document.getElementById('input-friend').value = '';
    await selectProfile(currentProfileId); 
    setStatus(`"${found[0].name}" removed from friends list.`);
  } catch (err) {
    setStatus(`Error removing friend: ${err.message}`, true);
  }
}

// ================================================================
// Section 6: Event Listener Setup
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {

  // Left panel controls
  document.getElementById('btn-add').addEventListener('click', addProfile);
  document.getElementById('btn-lookup').addEventListener('click', lookUpProfile);
  document.getElementById('btn-delete').addEventListener('click', deleteProfile);

  // Right panel controls
  document.getElementById('btn-status').addEventListener('click', changeStatus);
  document.getElementById('btn-picture').addEventListener('click', changePicture);
  document.getElementById('btn-add-friend').addEventListener('click', addFriend);
  document.getElementById('btn-remove-friend').addEventListener('click', removeFriend);
  document.getElementById('btn-quote').addEventListener('click', changeQuote);

  document.getElementById('btn-exit').addEventListener('click', () => {
    if (!window.close()) setStatus('To exit, close this browser tab.');
  });

  // Enter key shortcuts
  document.getElementById('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') addProfile(); });
  document.getElementById('input-status').addEventListener('keydown', e => { if (e.key === 'Enter') changeStatus(); });
  document.getElementById('input-quote').addEventListener('keydown', e => { if (e.key === 'Enter') changeQuote(); });
  document.getElementById('input-friend').addEventListener('keydown', e => { if (e.key === 'Enter') addFriend(); });

  await loadProfileList();
  setStatus('Ready. Select a profile from the list or add a new one.');
});