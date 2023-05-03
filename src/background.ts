// import browser from "webextension-polyfill";
import supabase from './lib/supabase-client';

type Message =
  | {
      action: 'fetch' | 'getSession' | 'signout';
      value: null;
    }
  | {
      action: 'signup' | 'signin';
      value: {
        email: string;
        password: string;
      };
    };

type ResponseCallback = (data: any) => void;

async function handleMessage(
  { action, value }: Message,
  response: ResponseCallback
) {
  if (action === 'fetch') {
    const result = await fetch('https://meowfacts.herokuapp.com/');

    const { data } = await result.json();
    response({ message: 'Successfully signed up!', data });
  } else if (action === 'signup') {
    const result = await supabase.auth.signUp(value);
    response({ message: 'Successfully signed up!', data: result });
  } else if (action === 'signin') {
    console.log('requesting auth');
    const { data, error } = await supabase.auth.signInWithPassword(value);

    if (data.session?.access_token) {
      const creds = JSON.stringify({
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
      });
      await chrome.storage.local.set({
        jwt: creds,
      });
    }
    response({ data, error });
  } else if (action === 'getSession') {
    const maybeJWT = await chrome.storage.local.get('jwt');
    console.log(maybeJWT);
    if (maybeJWT.jwt && maybeJWT.jwt !== '{}') {
      const parsedJSON = JSON.parse(maybeJWT.jwt);
      console.log(parsedJSON);
      const data = await supabase.auth.setSession(parsedJSON);
      console.log(data);
      return response(data);
    } else {
      supabase.auth.getSession().then(async (data) => {
        return response(data);
      });
    }
  } else if (action === 'signout') {
    const { error } = await supabase.auth.signOut();
    response({ data: null, error });
  } else {
    response({ data: null, error: 'Unknown action' });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, response) => {
  console.log('hey');
  handleMessage(msg, response);
  return true;
});
