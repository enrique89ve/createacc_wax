import { BRAND } from '@/consts/branding'
import type { Messages } from './types'
import { privateEn } from './private-copy'

export const en: Messages = {
  localeSwitch: {
    label: 'Language',
  },
  common: {
    cancel: 'Cancel',
    download: 'Download',
    error: 'Error',
    success: 'Success',
    loading: 'Loading...',
    close: 'Close',
  },
  invite: {
    title: 'Create your Hive account',
    introduction: 'Get a personal link to create your account for free.',
    signInGithub: 'Continue with GitHub',
    signInTwitter: 'Continue with X',
    personal:
      'One invitation per social account. Sign in again to resume your progress.',
    preparing: 'Preparing your link...',
    ready: 'Your access is ready',
    welcomeDeveloper: 'Welcome, Dev',
    welcomeCreator: 'Welcome',
    welcomeEnd: '!',
    developerDescription: 'You are one step away from building on Hive.',
    creatorDescription:
      'Your path as a Web3 creator is about to begin on Hive.',
    codeLabel: 'Access code',
    copyCode: 'Copy',
    codeCopied: 'Code copied',
    oneUse: 'Use it once.',
    linkLabel: 'Your account creation link',
    copy: 'Copy link',
    copied: 'Link copied',
    copyError: 'Could not copy. Please try again.',
    continue: 'Continue creating',
    processing: 'We are checking your account',
    processingDescription:
      'Your account creation is still in progress. We keep your invitation reserved while checking the result.',
    completed: 'Your account is already created',
    completedDescription: 'This invitation was already used to create',
    simulatedCompleted: 'You finished the practice run',
    simulatedCompletedDescription:
      'This invitation was already used for the practice username',
    unavailable: 'Invitations are currently unavailable.',
    quota:
      'This campaign has no invitations left. If you already have one, sign in to resume it.',
    paused: 'This campaign is paused. Check back later to request your link.',
    error: 'Could not complete the request. Please try again.',
    retry: 'Try again',
    refresh: 'Check status',
    connecting: 'Connecting...',
    signOut: 'Sign out',
    loginAgain: 'Sign in again to continue.',
  },
  home: {
    title: 'Create your Hive account',
    metaDescription: 'Create your Hive account.',
    usernameLabel: 'Username',
    accessCodeLabel: 'Access code',
    accessCodeVerify: 'Verify',
    accessCodeVerified: 'Access code verified',
    accessCodeRemove: 'Remove access code',
    continue: 'Continue',
    verifying: 'Verifying...',
    continueError: 'Could not continue. Please try again.',
    continueErrorButton: 'Error — Try again',
    flowErrors: {
      pow: 'Could not verify the request. Please try again.',
      timing: 'Time verification did not complete. Please try again.',
      rateLimited: 'Too many attempts. Try again in {seconds} seconds.',
      usernameRequired: 'Enter a username to continue.',
      serviceUnavailable:
        'Could not start the session due to a temporary problem. Please try again.',
    },
  },
  stepper: {
    ariaLabel: 'Account creation progress',
    account: 'Account',
    security: 'Security',
    ready: 'Ready',
  },
  username: {
    available: '@{username} is available',
    taken: '@{username} is already taken',
    notAllowed: 'This username is not allowed',
    tooSimilar: 'This username is too similar to a recent account',
    chainError: 'Could not connect to Hive',
    checkUnavailable: 'Could not check this username. Please try again.',
    checkRateLimited: 'Too many checks. Try again in {seconds} seconds.',
    format: {
      empty: 'Enter a username.',
      tooShort: 'Use at least 3 characters.',
      tooLong: 'Use at most 16 characters.',
      startLowercase: 'Must start with a lowercase letter.',
      onlyAllowed: 'Use only lowercase letters, numbers, or hyphens.',
      endLowerOrDigit: 'Must end with a letter or a number.',
      segmentStartLowercase: 'Each segment must start with a lowercase letter.',
      segmentOnlyAllowed:
        'Each segment can only use lowercase letters, numbers, or hyphens.',
      segmentEndLowerOrDigit:
        'Each segment must end with a letter or a number.',
      segmentTooShort: 'Each segment must have at least 3 characters.',
    },
  },
  accessCode: {
    validating: 'Validating...',
    invalid: 'Invalid access code',
    verifyError: 'Could not validate the code. Please try again.',
    format: {
      empty: 'Enter your access code.',
      tooShort: 'The access code is too short.',
      tooLong: 'The access code is too long.',
      invalidChars: 'The access code can only contain letters and numbers.',
      onlyNumbers: 'The access code cannot be only numbers.',
      invalidFormat: 'The access code is not valid.',
    },
    validationErrors: {
      invalidCode: 'The access code is invalid.',
      notFound: 'The access code was not found.',
      invalidRecord: 'The access code is invalid.',
      temporarilyUnavailable: 'The access code is temporarily unavailable.',
      inactive: 'The access code is inactive.',
      noUses: 'The access code has no uses remaining.',
      internalError: 'The access code could not be validated.',
    },
  },
  details: {
    title: 'Account details',
    metaDescription: 'Review and save the details for your account.',
    accountToCreate: 'Account to create:',
    masterPasswordLabel: 'Master password',
    generatingKeys: 'Generating secure keys…',
    masterPasswordHidden: 'Master password hidden.',
    masterPasswordHelp:
      'Your master password gives access to your account. Keep it in a safe place.',
    masterPasswordPrivacy:
      'It is generated on your device and HolaHive does not store it.',
    showMasterPassword: 'Show master password',
    hideMasterPassword: 'Hide master password',
    copy: 'Copy',
    copied: 'Copied',
    copyMasterPassword: 'Copy master password',
    masterPasswordCopied: 'Master password copied.',
    masterPasswordCopyFailed:
      'Could not copy it. Reveal and select it to copy it manually.',
    downloadBackup: 'Download backup',
    downloadKeysAria: 'Download the account keys',
    backupDownloaded: 'Backup downloaded',
    downloadStarted: 'Download started',
    confirmation:
      'I have saved my master password and understand that HolaHive cannot recover it for me.',
    keysSafetyCheckbox:
      'I have saved my keys. Without them, I will lose access to my account.',
    createAccount: 'Create account',
    creatingAccount: 'Creating account...',
    downloadKeysRequired: 'Download your keys first.',
    generateKeysError:
      'Could not generate keys in this browser. Check browser support and try again.',
    retryKeyGeneration: 'Retry key generation',
    reloadNewKeys: 'New keys were generated. You must download them again.',
    keysDownloadedBoth:
      'TXT and PDF downloads were started. Confirm that you saved the keys.',
    fileDownloadFailed: 'Could not start the key file download.',
    keyConfirmationRequired:
      'Waiting for server confirmation. Retry it from the download menu.',
    keyConfirmationFailed:
      'The file was generated, but its confirmation was not recorded. Retry here; you do not need to download it again.',
    keyConfirmationSucceeded: 'Key confirmation was recorded.',
    retryKeyConfirmation: 'Retry confirmation',
    retryingKeyConfirmation: 'Confirming...',
    verificationError:
      'Could not prepare verification; the request was not sent. Please try again.',
    creationRateLimited: 'Too many requests. Try again in {seconds} seconds.',
    creationOutcomeUnknown:
      'The connection ended before we received a result. Hive may have processed the request. Keep this page and your keys; retry here to check the same attempt.',
    creationPending:
      'Hive has not confirmed the final status. Keep this page and your keys; you can retry this same process later. Reference: {correlationId}.',
    creationErrors: {
      creationContextChanged:
        'The creation context no longer matches this attempt. Keep your keys and restart from the home page. A simulated account cannot be reused as a real account.',
      accountAlreadyExists:
        'This username already exists on Hive. Check the username before continuing.',
      ticketNotFound: 'The ticket does not exist in the database.',
      ticketInUse:
        'Another request is using this ticket. Please try again later.',
      ticketUsed: 'The ticket has no uses remaining.',
      creationInProgress:
        'A request for this account is already in progress. Wait a moment and try again.',
      usernameNotAllowed: 'This username is not allowed.',
      usernameTooSimilar:
        'This username is too similar to an account created recently.',
      keysNotConfirmed:
        'The key download was not confirmed. Retry the confirmation.',
      serviceUnavailable:
        'A service check could not be completed. Please try again later.',
      generic:
        'Account creation could not be completed. Check the username and ticket.',
    },
    createPrefix: 'Create',
    advancedKeys: 'View advanced keys',
  },
  progress: {
    modalTitle: 'Creating your account',
    modalSubtitle: 'Please wait while we process your request',
    stepVerifying: 'Verifying information',
    stepCreating: 'Creating account',
    stepRedirecting: 'Redirecting',
    statusActive: 'In progress...',
    statusCompleted: 'Completed',
    statusError: 'Error',
    creatingPrefix: 'Creating',
    preparing: 'Preparing your account',
    creatingOnHive: 'Creating on Hive',
    confirming: 'Confirming',
    created: 'Account created',
    ariaLabel: 'Account creation progress',
  },
  success: {
    title: 'Your account is ready',
    metaDescription: 'Your Hive account is ready.',
    welcomeTitle: 'Welcome to Hive!',
    accountCreatedLead: 'Congratulations, account',
    accountCreatedTail: 'was created successfully.',
    body: 'You can now use your account on Hive.',
    readySubtitle: 'Your account is ready to access Hive.',
    activeBody: 'is now active on Hive.',
    keychainCta: 'Download Keychain',
    postCta: '+ Post',
    keychainTitle: 'Set up Hive Keychain',
    keychainDownloadTitle: 'Download Hive Keychain',
    keychainDownloadBody: 'Manage your keys and sign transactions',
    keychainBody:
      'Use your username and the Master Password you just saved to add your account.',
    keychainInstall: 'Install Hive Keychain',
    keychainBadgeExtension: 'Extension',
    keychainBadgeGooglePlay: 'Google Play',
    keychainBadgeAppStore: 'App Store',
    exploreTitle: 'Ecosystem apps',
    exploreBody:
      'Explore and start interacting with the community using these DApps.',
    favoriteBadge: 'Favorite',
    appIconAlt: 'Icon',
    communityTitle: 'Need help? Join the community!',
    communityBody:
      'Join our Telegram group for support, share ideas, and learn more about Hive.',
    communityCta: 'Join the group',
    simulated: {
      title: 'Practice run complete',
      metaDescription:
        'You finished the creation flow. No Hive account was created.',
      welcomeTitle: 'Practice run complete',
      accountCreatedLead: 'You completed the flow as',
      accountCreatedTail: '. No Hive account was created.',
      readySubtitle:
        'Keep any keys you downloaded. They cannot be used on Hive until a real launch.',
    },
    apps: {
      peakd: 'Advanced social platform',
      hiveblog: 'Classic social portal',
      threespeak: 'Decentralized video',
      ecency: 'Social + mobile',
      inleo: 'Microblogging & finance',
      liketu: 'Photos and lifestyle',
    },
  },
  keys: {
    header: 'HIVE ACCOUNT KEYS - {USERNAME}',
    footer: `Generated with ${BRAND.NAME} - ${BRAND.URL}`,
    keepSafe: '⚠️  KEEP THESE KEYS SAFE - NEVER SHARE THEM ⚠️',
    masterKey: 'MASTER KEY',
    ownerKey: 'OWNER PRIVATE KEY',
    activeKey: 'ACTIVE PRIVATE KEY',
    postingKey: 'POSTING PRIVATE KEY',
    memoKey: 'MEMO PRIVATE KEY',
    generatedAtLabel: 'Generated:',
    keysetIdLabel: 'Keyset ID:',
    pdfTitle: 'Your account: {username}',
    pdfMasterPasswordLabel: 'Master Password',
    pdfRolesHeading: 'Roles',
    pdfRoleKeyTitle: '{role} key:',
    pdfWindowTitle: 'Keys for {username}',
    roleNames: {
      owner: 'OWNER',
      active: 'ACTIVE',
      posting: 'POSTING',
      memo: 'MEMO',
      master: 'MASTER',
    },
    descriptions: {
      posting:
        'Use it to post, comment, vote, and authorize social actions in apps. It does not transfer HIVE or HBD by itself. An app can accept this signature for operations it defines, so do not share it.',
      active:
        'Moves HIVE, HBD, and Hive Power: transfers, exchanges, power up, and power down. Anyone who has it can spend the account funds.',
      owner:
        'Changes the other keys and can recover the account. It can also do what the active key does. Keep it offline.',
      memo: 'Encrypts and decrypts memos attached to transfers and other encrypted account messages. Anyone with it can read those memos. It does not move funds by itself.',
      master:
        'The other keys are derived from this password. Anyone who has it controls the account completely. Keep it offline and do not reuse it.',
    },
  },
  downloadModal: {
    title: 'Select download format',
    subtitle: 'Choose how you want to save your keys',
    formats: {
      txt: {
        title: 'Text file (.txt)',
        description: 'Simple and universal format',
      },
      pdf: {
        title: 'PDF document (.pdf)',
        description: 'Professional format with descriptions',
      },
    },
  },
  messages: {
    keysDownloaded: 'Keys downloaded in {format} format',
    downloadError: 'Error downloading keys',
    pdfGenerationFailed: 'Failed to generate PDF.',
    unsupportedFormat: 'Unsupported format: {format}',
  },
  ...privateEn,
}
