// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import InstructorAttendance from './InstructorAttendance';
import { israelDate, shiftDate } from '@/lib/clubAttendance';
const state=vi.hoisted(()=>({role:'מדריך',rpc:vi.fn(),sessions:[],roster:[],linked:true}));
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({user:{role:state.role}})}));
vi.mock('@/api/supabaseClient',()=>({supabase:{rpc:(...args)=>state.rpc(...args),from:()=>{throw new Error('Instructor page must use limited projections');}}}));
beforeEach(()=>{
 state.role='מדריך';state.linked=true;
 state.sessions=[{id:'s',club_name:'חוג בדיקה',session_date:israelDate(),start_time:'16:00',end_time:'17:00',status:'scheduled'}];
 state.roster=[{membership_id:'m',participant_name:'משתתף בדיקה',status:null,notes:'',version:0}];
 state.rpc.mockReset().mockImplementation(async name=>({data:name==='get_instructor_club_sessions'?{linked:state.linked,sessions:state.sessions}:name==='get_instructor_club_roster'?state.roster:1,error:null}));
});
afterEach(cleanup);
test.each(['admin','קופאי','אחמ"ש',undefined])('other role %s cannot load instructor workspace',role=>{
 state.role=role;render(<InstructorAttendance/>);expect(screen.getByRole('alert')).toHaveTextContent('אין הרשאה');expect(state.rpc).not.toHaveBeenCalled();
});
test('session list and refresh are read-only with no admin/billing UI',async()=>{
 render(<InstructorAttendance/>);await screen.findByText('חוג בדיקה');
 expect(screen.queryByText(/יצירת מפגשים|ניהול חוגים/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'רענון'}));
 await waitFor(()=>expect(state.rpc).toHaveBeenCalledTimes(2));
 expect(state.rpc.mock.calls.every(([name])=>name==='get_instructor_club_sessions')).toBe(true);
});
test('unlinked instructor has clear admin-link instruction',async()=>{
 state.linked=false;state.sessions=[];render(<InstructorAttendance/>);
 expect(await screen.findByText(/טרם קושר/)).toBeInTheDocument();
});
test('own attendance marking and correction submit exact version; concurrent click guarded',async()=>{
 render(<InstructorAttendance/>);fireEvent.click(await screen.findByRole('button',{name:'פתיחת נוכחות'}));
 await screen.findByText('משתתף בדיקה');fireEvent.change(screen.getByLabelText('הערה עבור משתתף בדיקה'),{target:{value:'בדיקה'}});
 let release=(_result)=>{};const pending=new Promise(resolve=>{release=resolve;});
 state.rpc.mockImplementation(name=>name==='mark_club_attendance'?pending:Promise.resolve({data:name==='get_instructor_club_sessions'?{linked:true,sessions:state.sessions}:state.roster,error:null}));
 const button=screen.getByRole('button',{name:'נוכח'});fireEvent.click(button);fireEvent.click(button);
 expect(state.rpc.mock.calls.filter(([name])=>name==='mark_club_attendance')).toHaveLength(1);
 expect(state.rpc).toHaveBeenCalledWith('mark_club_attendance',{p_session_id:'s',p_membership_id:'m',p_status:'present',p_expected_version:0,p_notes:'בדיקה'});
 release({data:null,error:{message:'attendance_conflict'}});expect(await screen.findByRole('alert')).toHaveTextContent('עודכנו במקביל');
});
test.each(['cancelled','future'])('%s session cannot be marked',async kind=>{
 if(kind==='cancelled')state.sessions[0].status='cancelled';else state.sessions[0].session_date=shiftDate(israelDate(),1);
 render(<InstructorAttendance/>);fireEvent.click(await screen.findByRole('button',{name:'פתיחת נוכחות'}));
 expect(await screen.findByRole('button',{name:'נוכח'})).toBeDisabled();
});
test('reassignment denial clears previously displayed roster',async()=>{
 render(<InstructorAttendance/>);fireEvent.click(await screen.findByRole('button',{name:'פתיחת נוכחות'}));await screen.findByText('משתתף בדיקה');
 state.rpc.mockResolvedValue({data:null,error:{message:'attendance_forbidden'}});
 fireEvent.click(screen.getByRole('button',{name:'רענון'}));
 await screen.findByRole('alert');expect(screen.queryByText('משתתף בדיקה')).not.toBeInTheDocument();
});
