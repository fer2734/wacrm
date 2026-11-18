-- Transactional regression: synthetic user only; every change is rolled back.
BEGIN;
DO $$
DECLARE a uuid; o uuid; u uuid:=gen_random_uuid(); personal uuid; c uuid; chat uuid; task uuid; token text:=rtrim(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'='); count_before integer;
BEGIN
 SELECT ac.id,ac.owner_user_id INTO a,o FROM public.accounts ac JOIN public.whatsapp_config w ON w.account_id=ac.id LIMIT 1;
 IF a IS NULL THEN RAISE EXCEPTION 'Test requires an existing CRM account'; END IF;
 INSERT INTO public.account_invitations(account_id,token_hash,role,created_by_user_id,expires_at)
 VALUES(a,encode(digest(token,'sha256'),'hex'),'agent',o,now()+interval '1 hour');
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(u,u::text||'@offboarding.invalid',jsonb_build_object('full_name','Asesor de prueba','invitation_token',token));
 SELECT account_id INTO personal FROM public.profiles WHERE user_id=u;
 UPDATE public.profiles SET account_id=a,account_role='agent' WHERE user_id=u;
 DELETE FROM public.accounts WHERE id=personal;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=u) THEN RAISE EXCEPTION 'Fixture profile missing'; END IF;
 INSERT INTO public.contacts(user_id,account_id,name,phone) VALUES(u,a,'Prueba de conservación',u::text) RETURNING id INTO c;
 INSERT INTO public.conversations(user_id,account_id,contact_id,assigned_agent_id,status) VALUES(u,a,c,u,'closed') RETURNING id INTO chat;
 INSERT INTO public.contact_notes(user_id,account_id,contact_id,note_text) VALUES(u,a,c,'Nota conservada');
 INSERT INTO public.advisor_tasks(user_id,account_id,contact_id,title,kind,starts_at) VALUES(u,a,c,'Llamada de prueba','call',now()+interval '1 day') RETURNING id INTO task;
 SELECT count(*) INTO count_before FROM public.accounts;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 BEGIN
  PERFORM public.remove_account_member(o);
  RAISE EXCEPTION 'Agent deleted owner';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM set_config('request.jwt.claim.sub',o::text,true);
 BEGIN
  PERFORM public.remove_account_member(o);
  RAISE EXCEPTION 'Owner deleted self';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 PERFORM public.remove_account_member(u);
 IF EXISTS(SELECT 1 FROM public.profiles WHERE user_id=u) THEN RAISE EXCEPTION 'Profile still exists'; END IF;
 IF (SELECT count(*) FROM public.accounts)<>count_before THEN RAISE EXCEPTION 'Unexpected personal account'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=chat AND assigned_agent_id IS NULL AND status='pending' AND ai_autoreply_disabled) THEN RAISE EXCEPTION 'Chat not pending'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.member_deletion_jobs WHERE user_id=u AND account_id=a AND finished_at IS NULL) THEN RAISE EXCEPTION 'Missing deletion job'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.advisor_tasks WHERE id=task AND user_id=o) THEN RAISE EXCEPTION 'Tasks not transferred'; END IF;
 -- Simulate the Admin API's final identity delete, using only our synthetic user.
 DELETE FROM auth.users WHERE id=u;
 IF NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=c AND user_id=o) OR
    NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=chat AND user_id=o) OR
    NOT EXISTS(SELECT 1 FROM public.contact_notes WHERE contact_id=c AND note_text LIKE '%Nota conservada%') OR
    NOT EXISTS(SELECT 1 FROM public.advisor_tasks WHERE id=task AND user_id=o) THEN RAISE EXCEPTION 'Company data lost on identity deletion'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('test.offboarding.contact',c::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.contacts WHERE id=current_setting('test.offboarding.contact')::uuid) THEN RAISE EXCEPTION 'Former session can still read CRM'; END IF;
 IF has_table_privilege('authenticated','public.member_deletion_jobs','INSERT') THEN RAISE EXCEPTION 'Client can enqueue arbitrary identity deletion'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
